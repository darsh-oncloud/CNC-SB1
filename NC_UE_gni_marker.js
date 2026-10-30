/**
 * Marks what came from GNi, so CNC can find and count GNi orders.
 *
 * Two jobs, one script (deployed on three record types):
 *
 *  1. Product List (customrecord_ns_pl_productlist), on create: if Receive Payload is filled, set
 *     Originator (custrecord_nc_pl_originator) to "GNi". Only the "CNC | GNI Draft Order
 *     Integration" RESTlet fills Receive Payload (it stores the raw GNi cart there), so a list with a
 *     payload came from GNi.
 *  2. Estimate and Sales Order, on create: follow CabNet's link from the order back to the draft (each
 *     line's custcol_rsm_line_json carries the Product List id as "wishlistId", the same link RSM's
 *     scripts use for the GNI Project ID). If any draft behind the order is a GNi draft, set Order Path
 *     (custbody_nc_order_path) to "GNi".
 *
 * Why a script: NetSuite's standard features cover part of this. A SuiteFlow workflow could set the
 * Product List field, but it can't be unit tested or reviewed as a diff, and nothing standard parses the
 * line JSON to find the draft behind an order and read a field from it, which is the part that has to be
 * a script. A formula field is no use: unstored formula fields don't appear in searches. One script
 * keeps both markers in one tested place. The GNi RESTlet and RSM's scripts stay untouched.
 *
 * The marker is a nice-to-have: nothing here may stop an order or a draft from saving, so every
 * failure is logged and swallowed.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/log'], (search, log) => {

    const PRODUCT_LIST = 'customrecord_ns_pl_productlist';
    const PAYLOAD_FIELD = 'custrecord_receive_payload';
    const ORIGINATOR_FIELD = 'custrecord_nc_pl_originator';
    const ORDER_PATH_FIELD = 'custbody_nc_order_path';
    const ORDER_PATH_LIST = 'customlist_nc_order_path';
    const GNI_VALUE_NAME = 'GNi';
    const LINE_JSON_FIELD = 'custcol_rsm_line_json';
    const ORDER_TYPES = ['estimate', 'salesorder'];

    const isFilled = (value) => value !== null && value !== undefined && String(value).trim() !== '';

    /** Internal id of the "GNi" value in the NC Order Path list, or null if it isn't there. */
    const getGniValueId = () => {
        let valueId = null;
        search.create({
            type: ORDER_PATH_LIST,
            filters: [['name', 'is', GNI_VALUE_NAME]],
            columns: ['internalid']
        }).run().each((result) => {
            valueId = String(result.id);
            return false;
        });
        return valueId;
    };

    /** A select field comes back from lookupFields as [{ value, text }]; this returns the value. */
    const selectedValue = (lookedUp) => {
        if (Array.isArray(lookedUp)) return lookedUp.length ? String(lookedUp[0].value) : '';
        return isFilled(lookedUp) ? String(lookedUp) : '';
    };

    /** Product List created through the GNi RESTlet: set the originator. */
    const markProductList = (newRecord) => {
        if (!isFilled(newRecord.getValue({ fieldId: PAYLOAD_FIELD }))) return;
        if (isFilled(newRecord.getValue({ fieldId: ORIGINATOR_FIELD }))) return;

        const id = getGniValueId();
        if (!id) {
            log.error({ title: 'GNi marker', details: `No "${GNI_VALUE_NAME}" value found in ${ORDER_PATH_LIST}` });
            return;
        }
        newRecord.setValue({ fieldId: ORIGINATOR_FIELD, value: id });
    };

    /** The distinct Product List ids that the lines of an order point to. */
    const getDraftIds = (newRecord) => {
        const ids = [];
        const lineCount = newRecord.getLineCount({ sublistId: 'item' });
        for (let line = 0; line < lineCount; line++) {
            const json = newRecord.getSublistValue({ sublistId: 'item', fieldId: LINE_JSON_FIELD, line });
            // Cheap check first: most lines (EDI, manual orders) have no line JSON at all.
            if (!isFilled(json) || String(json).indexOf('wishlistId') === -1) continue;
            try {
                const draftId = JSON.parse(json).wishlistId;
                if (isFilled(draftId) && ids.indexOf(String(draftId)) === -1) ids.push(String(draftId));
            } catch (e) {
                log.debug({ title: 'GNi marker: line JSON not readable', details: `line ${line}: ${e.message}` });
            }
        }
        return ids;
    };

    /** Is this Product List a GNi draft: originator is GNi, or it holds a GNi payload. */
    const isGniDraft = (draftId, gniId) => {
        let found;
        try {
            found = search.lookupFields({ type: PRODUCT_LIST, id: draftId, columns: [ORIGINATOR_FIELD, PAYLOAD_FIELD] });
        } catch (e) {
            // The originator field may not exist yet (it is created by hand before the script goes in).
            found = search.lookupFields({ type: PRODUCT_LIST, id: draftId, columns: [PAYLOAD_FIELD] });
        }
        return selectedValue(found[ORIGINATOR_FIELD]) === gniId || isFilled(found[PAYLOAD_FIELD]);
    };

    /** Estimate or Sales Order created from a draft: set the order path when the draft is GNi's. */
    const markOrder = (newRecord) => {
        if (isFilled(newRecord.getValue({ fieldId: ORDER_PATH_FIELD }))) return;

        const draftIds = getDraftIds(newRecord);
        if (!draftIds.length) return;

        const gniId = getGniValueId();
        if (!gniId) {
            log.error({ title: 'GNi marker', details: `No "${GNI_VALUE_NAME}" value found in ${ORDER_PATH_LIST}` });
            return;
        }
        const fromGni = draftIds.some((draftId) => {
            try {
                return isGniDraft(draftId, gniId);
            } catch (e) {
                // One draft that can't be read (for example, deleted) must not hide the others.
                log.error({ title: 'GNi marker: draft not readable', details: `Product List ${draftId}: ${e.message}` });
                return false;
            }
        });
        if (fromGni) {
            newRecord.setValue({ fieldId: ORDER_PATH_FIELD, value: gniId });
        }
    };

    const beforeSubmit = (context) => {
        try {
            if (context.type !== context.UserEventType.CREATE) return;

            const newRecord = context.newRecord;
            if (newRecord.type === PRODUCT_LIST) {
                markProductList(newRecord);
            } else if (ORDER_TYPES.indexOf(newRecord.type) !== -1) {
                markOrder(newRecord);
            }
        } catch (e) {
            log.error({ title: 'GNi marker failed (record still saves)', details: e.message || String(e) });
        }
    };

    return { beforeSubmit };
});
