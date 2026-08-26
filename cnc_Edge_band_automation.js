/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * SALES ORDER - EDGE BAND AUTOMATION
 *
 * Trigger line = item 429828 AND PO107 = CLM_EB (both required).
 * For every OTHER line whose item carries Item Option 9097 (CUSTCOL_YY_MOD_EDGEBAND):
 *      set Edge Band = Yes on that line
 *      insert markup item 306264 directly under it,
 *      copying PO107 + Assigned ID from the trigger line
 * Then delete the trigger line.
 *
 * Non-eligible lines are never touched.
 * Runs on CREATE and EDIT. After the trigger line is gone SEARCH 1 returns
 * 0 rows, so a re-save exits before the record load - nothing is added twice
 * and nothing is deleted.
 *
 * 1 record.load() + 1 save() per execution. No item loads.
 */
define(['N/search', 'N/record', 'N/query', 'N/log'], (search, record, query, log) => {

    const CUSTOMER    = '161136';
    const CLM_ITEM    = '429828';                    // placeholder item carrying CLM_EB from EDI
    const MARKUP_ITEM = '306264';                    // CT-EDGEBAND 10%
    const EDGE_OPTION = '9097';                      // item option internal id (SuiteQL side)
    const EDGE_FIELD  = 'custcol_yy_mod_edgeband';   // item option script id (line side)
    const EDGE_VALUE  = 'Yes';                       // value written on the eligible line

    // itemoptions is not searchable -> read it with SuiteQL.
    // Loop stops as soon as every item id has been found.
    const ITEM_TABLES = [
        'assemblyitem', 'serializedassemblyitem', 'lotnumberedassemblyitem',
        'inventoryitem', 'serializedinventoryitem', 'lotnumberedinventoryitem',
        'kititem',
        'noninventoryitem', 'noninventorysaleitem', 'noninventoryresaleitem',
        'serviceitem', 'servicesaleitem', 'serviceresaleitem',
        'otherchargeitem', 'otherchargesaleitem', 'otherchargeresaleitem'
    ];

    const getEdgeItems = (ids) => {

        const edge = {};
        let left = ids.slice();

        ITEM_TABLES.forEach(table => {

            if (!left.length) return;

            try {
                query.runSuiteQL({
                    query: `SELECT id, itemoptions FROM ${table} WHERE id IN (${left.join(',')})`
                }).asMappedResults().forEach(row => {

                    const options = String(row.itemoptions || '').split(',').map(v => v.trim());

                    if (options.indexOf(EDGE_OPTION) > -1) edge[String(row.id)] = true;

                    left = left.filter(id => id !== Number(row.id));
                });
            } catch (e) {
                // table / feature not enabled in this account - keep going
            }
        });

        return edge;
    };


    const afterSubmit = (context) => {

        let step = 'init';

        try {

            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) return;

            const soId = context.newRecord.id;

            if (String(context.newRecord.getValue('entity')) !== CUSTOMER) return;


            // =========================================================
            // SEARCH 1 - trigger line: item 429828 AND PO107 = CLM_EB
            // =========================================================
            step = 'search trigger line';

            const clm = search.create({
                type: search.Type.SALES_ORDER,
                filters: [
                    ['internalid', 'anyof', soId], 'AND',
                    ['mainline', 'is', 'F'], 'AND',
                    ['taxline', 'is', 'F'], 'AND',
                    ['cogs', 'is', 'F'], 'AND',
                    ['shipping', 'is', 'F'], 'AND',
                    ['custcolproductserviceid_po107', 'is', 'CLM_EB'], 'AND',
                    ['item', 'anyof', CLM_ITEM]
                ],
                columns: ['lineuniquekey', 'custcolassigned_id', 'custcolproductserviceid_po107']
            }).run().getRange({ start: 0, end: 2 });

            // 0 = nothing to do / already processed, 2+ = do not run
            if (clm.length !== 1) return;

            const clmKey   = String(clm[0].getValue('lineuniquekey'));
            const assigned = clm[0].getValue('custcolassigned_id');
            const po107    = clm[0].getValue('custcolproductserviceid_po107');


            // =========================================================
            // SEARCH 2 - candidate lines
            // =========================================================
            step = 'search order lines';

            const lines = [];

            search.create({
                type: search.Type.SALES_ORDER,
                filters: [
                    ['internalid', 'anyof', soId], 'AND',
                    ['mainline', 'is', 'F'], 'AND',
                    ['taxline', 'is', 'F'], 'AND',
                    ['cogs', 'is', 'F'], 'AND',
                    ['shipping', 'is', 'F']
                ],
                columns: ['item', 'lineuniquekey']
            }).run().each(r => {

                const itemId  = String(r.getValue('item') || '');
                const lineKey = String(r.getValue('lineuniquekey') || '');

                // never a candidate: trigger line, other placeholder lines, markup lines
                if (lineKey !== clmKey && itemId !== MARKUP_ITEM && itemId !== CLM_ITEM) {
                    lines.push({ itemId, lineKey });
                }
                return true;
            });

            if (!lines.length) return;


            // =========================================================
            // SUITEQL - which items carry the edge band option
            // =========================================================
            step = 'suiteql item options';

            const edge = getEdgeItems([...new Set(lines.map(l => Number(l.itemId)))]);
            const eligible = lines.filter(l => edge[l.itemId]);

            if (!eligible.length) {
                log.audit('STOP', 'SO ' + soId + ' - no edge band items');
                return;
            }


            // =========================================================
            // LOAD - dynamic required, item options are not writable
            //        in standard mode
            // =========================================================
            step = 'load';

            const so = record.load({
                type: record.Type.SALES_ORDER,
                id: soId,
                isDynamic: true
            });


            eligible.forEach(l => {

                // ---- 1. main line: Edge Band = Yes
                let src = so.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: l.lineKey
                });

                if (src === -1) return;

                step = 'selectLine ' + src + ' item ' + l.itemId;
                so.selectLine({ sublistId: 'item', line: src });

                step = 'set edge band on line ' + src;

                try {
                    so.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: EDGE_FIELD,
                        value: EDGE_VALUE,
                        ignoreFieldChange: true
                    });
                } catch (optErr) {

                    // never kill the run - log what the line actually holds
                    let raw = '';
                    try {
                        raw = so.getCurrentSublistValue({ sublistId: 'item', fieldId: 'options' });
                    } catch (ignore) { raw = 'options not readable'; }

                    log.error('EDGE OPTION SET FAILED', {
                        line: src,
                        item: l.itemId,
                        field: EDGE_FIELD,
                        value: EDGE_VALUE,
                        rawOptions: raw,
                        message: optErr.message
                    });
                }

                step = 'commit main line ' + src;
                so.commitLine({ sublistId: 'item' });


                // ---- 2. markup line directly under it
                src = so.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: l.lineKey
                });

                step = 'insertLine at ' + (src + 1);
                so.insertLine({ sublistId: 'item', line: src + 1 });

                step = 'set markup item at ' + (src + 1);
                so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: MARKUP_ITEM });

                if (po107) {
                    so.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolproductserviceid_po107',
                        value: po107
                    });
                }

                if (assigned) {
                    so.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolassigned_id',
                        value: assigned
                    });
                }

                step = 'commit markup line at ' + (src + 1);
                so.commitLine({ sublistId: 'item' });
            });


            // =========================================================
            // REMOVE TRIGGER LINE + SAVE
            // =========================================================
            step = 'removeLine';

            const pos = so.findSublistLineWithValue({
                sublistId: 'item',
                fieldId: 'lineuniquekey',
                value: clmKey
            });

            if (pos > -1) so.removeLine({ sublistId: 'item', line: pos });

            step = 'save';
            so.save({ enableSourcing: true, ignoreMandatoryFields: false });

            log.audit('SUCCESS', {
                so: soId,
                markupLines: eligible.length,
                po107,
                assigned
            });

        } catch (e) {
            log.error('SO EDGE BAND ERROR', {
                so: context.newRecord.id,
                step,
                name: e.name,
                message: e.message,
                stack: e.stack
            });
        }
    };

    return { afterSubmit };
});