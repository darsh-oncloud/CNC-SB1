/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @author Ariella Hirsch
 * @description Sets the KDL shipping cost before save and sends the Sales Order to KDL after save.
 */
define(["require", "exports", "N/record", "N/query", "N/log", "./lib/kdl_api", "./lib/kdl_xml", "./lib/kdl_config"], function (require, exports, record, query, log, kdl_api_1, kdl_xml_1, kdl_config_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.afterSubmit = exports.beforeSubmit = void 0;
    // Freight terms if the SO goes to KDL, else null. Already-sent SOs are skipped unless resend is true.
    function getFreightTermsIfKdlOrder(soRecord, ordNum, resend = false) {
        if (kdl_config_1.SO_CUSTOM_FIELDS_READY && !resend && soRecord.getValue({ fieldId: kdl_config_1.SO_FIELDS.KDL_SENT_DATE })) {
            log.debug({ title: 'kdl_ue', details: `SO ${ordNum} already sent to 3GTMS - skipping` });
            return null;
        }
        const shipMethod = String(soRecord.getText({ fieldId: 'shipmethod' }) || '');
        if (!kdl_config_1.KDL_SHIP_METHOD_FREIGHT_TERMS[shipMethod]) {
            log.debug({ title: 'kdl_ue', details: `SO ${ordNum} ship method "${shipMethod}" not eligible for KDL - skipping` });
            return null;
        }
        return kdl_config_1.KDL_SHIP_METHOD_FREIGHT_TERMS[shipMethod];
    }
    // Checked on the SO or the customer - the SO box isn't always sourced.
    function isFreightIncluded(soRecord) {
        if (soRecord.getValue({ fieldId: kdl_config_1.SO_FIELDS.FREIGHT_INCLUDED }))
            return true;
        const customerId = soRecord.getValue({ fieldId: 'entity' });
        if (!customerId)
            return false;
        const rows = query.runSuiteQL({
            query: `SELECT ${kdl_config_1.CUSTOMER_FREIGHT_INCLUDED} AS freightincluded FROM customer WHERE id = ${customerId}`
        }).asMappedResults();
        return rows[0]?.freightincluded === 'T';
    }
    // Item and quantity per line - used to spot item changes that need a resend.
    function getItemLinesKey(soRecord) {
        const lines = [];
        for (let line = 0; line < soRecord.getLineCount({ sublistId: 'item' }); line++) {
            lines.push(`${soRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line })}x`
                + `${soRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line })}`);
        }
        return lines.join('|');
    }
    // Shipping cost = cheapest rate, unless freight is included or a cost is already set. Errors never block the save.
    const beforeSubmit = (context) => {
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT)
            return;
        const soRecord = context.newRecord;
        const ordNum = soRecord.getValue({ fieldId: 'tranid' });
        if (!getFreightTermsIfKdlOrder(soRecord, ordNum))
            return;
        try {
            const rate = (0, kdl_api_1.getCheapestFreightRate)((0, kdl_xml_1.getRateRequestFromSalesOrder)(soRecord));
            const freightIncluded = isFreightIncluded(soRecord);
            const existingShippingCost = Number(context.oldRecord?.getValue({ fieldId: 'shippingcost' }) || 0);
            if (!freightIncluded && !existingShippingCost) {
                soRecord.setValue({ fieldId: 'shippingcost', value: rate.totalAmount });
            }
            log.audit({
                title: 'kdl_ue_rated',
                details: `SO ${ordNum} -> ${rate.carrierName} (${rate.carrierScac}, ${rate.contractName}) @ $${rate.totalAmount}`
                    + ` (accessorials $${rate.totalNetAccessorial}: ${rate.accessorials.map(a => `${a.code} $${a.amount}`).join(', ')})`
                    + (freightIncluded ? ' - freight included, shipping cost not set'
                        : existingShippingCost ? ` - shipping cost $${existingShippingCost} kept` : ' - shipping cost set'),
            });
        }
        catch (e) {
            log.error({ title: 'kdl_ue_rating_error', details: `SO ${ordNum}: ${e instanceof Error ? e.message : String(e)}` });
        }
    };
    exports.beforeSubmit = beforeSubmit;
    // Sends new KDL orders, and resends when the items change. newRecord is already committed - no load needed.
    const afterSubmit = (context) => {
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT)
            return;
        const soRecord = context.newRecord;
        const ordNum = soRecord.getValue({ fieldId: 'tranid' });
        const itemsChanged = !!context.oldRecord && getItemLinesKey(context.oldRecord) !== getItemLinesKey(soRecord);
        const freightTerms = getFreightTermsIfKdlOrder(soRecord, ordNum, itemsChanged);
        if (!freightTerms)
            return;
        try {
            const result = (0, kdl_api_1.sendSalesOrderToKdl)(soRecord, freightTerms);
            if (!result.success) {
                log.error({ title: 'kdl_ue_order_failed', details: `SO ${ordNum}: ${result.messages.join(', ')}` });
                return;
            }
            // Marks the SO as sent and queues it for the scheduled script.
            if (kdl_config_1.SO_CUSTOM_FIELDS_READY) {
                record.submitFields({
                    type: record.Type.SALES_ORDER,
                    id: soRecord.id,
                    values: { [kdl_config_1.SO_FIELDS.KDL_SENT_DATE]: new Date() },
                    options: { ignoreMandatoryFields: true },
                });
            }
            log.audit({
                title: 'kdl_ue_complete',
                details: `SO ${ordNum} ${itemsChanged ? 'resent (items changed)' : 'sent'} to 3GTMS`
                    + (kdl_config_1.SO_CUSTOM_FIELDS_READY ? '' : ' [dry run - sent date not saved]'),
            });
        }
        catch (e) {
            log.error({ title: 'kdl_ue_error', details: `SO ${ordNum}: ${e instanceof Error ? e.message : String(e)}` });
        }
    };
    exports.afterSubmit = afterSubmit;
});
