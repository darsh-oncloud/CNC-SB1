/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * SALES ORDER - EDGE BAND MARKUP
 *
 * 1 CLM_EB line on the SO  ->  add markup item 306264 under every item
 * that has Item Option CUSTCOL_YY_MOD_EDGEBAND (internal id 9097),
 * copy PO107 + Assigned ID from the CLM_EB line, then delete the CLM_EB line.
 *
 * Runs on CREATE and EDIT. No loop: after the CLM_EB line is removed
 * SEARCH 1 returns 0 rows and the script exits immediately.
 */
define(['N/search', 'N/record', 'N/query', 'N/log'], (search, record, query, log) => {

    const CUSTOMER    = '161136';
    const CLM_ITEM    = '429828';      // placeholder item that carries CLM_EB from EDI
    const MARKUP_ITEM = '306264';
    const EDGE_OPTION = '9097';        // CUSTCOL_YY_MOD_EDGEBAND internal id

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

                    const options = String(row.itemoptions || '')
                        .split(',')
                        .map(v => v.trim());

                    if (options.indexOf(EDGE_OPTION) > -1) edge[String(row.id)] = true;

                    left = left.filter(id => id !== Number(row.id));
                });
            } catch (e) {
                // table/feature not enabled in this account - keep going
            }
        });

        return edge;
    };


    const afterSubmit = (context) => {

        try {

            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) return;

            const soId = context.newRecord.id;

            if (String(context.newRecord.getValue('entity')) !== CUSTOMER) return;


            // SEARCH 1 - the trigger line = item 429828 AND PO107 = CLM_EB.
            // BOTH conditions required. A line that only carries CLM_EB in the column
            // field (including the 306264 markup lines added by this script) is never
            // a trigger, so a re-save can never delete them.
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

            const clmKey    = String(clm[0].getValue('lineuniquekey'));
            const assigned  = clm[0].getValue('custcolassigned_id');
            const po107     = clm[0].getValue('custcolproductserviceid_po107');


            // SEARCH 2 - all other item lines
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

                // never a candidate: the trigger line, other placeholder lines, markup lines
                if (lineKey !== clmKey && itemId !== MARKUP_ITEM && itemId !== CLM_ITEM) {
                    lines.push({ itemId, lineKey });
                }
                return true;
            });

            if (!lines.length) return;


            // SuiteQL - which of those items carry the edge band option
            const edge = getEdgeItems([...new Set(lines.map(l => Number(l.itemId)))]);
            const eligible = lines.filter(l => edge[l.itemId]);

            if (!eligible.length) {
                log.audit('STOP', 'SO ' + soId + ' - no edge band items');
                return;
            }


            // 1 LOAD
            const so = record.load({
                type: record.Type.SALES_ORDER,
                id: soId,
                isDynamic: false
            });

            // add 306264 under each eligible line (markup item takes its % from the line above)
            eligible.forEach(l => {

                const src = so.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: l.lineKey
                });

                if (src === -1) return;

                const n = src + 1;

                so.insertLine({ sublistId: 'item', line: n });
                so.setSublistValue({ sublistId: 'item', fieldId: 'item', line: n, value: MARKUP_ITEM });

                if (po107) {
                    so.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolproductserviceid_po107',
                        line: n,
                        value: po107
                    });
                }

                if (assigned) {
                    so.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolassigned_id',
                        line: n,
                        value: assigned
                    });
                }
            });

            // remove the original CLM_EB line
            const pos = so.findSublistLineWithValue({
                sublistId: 'item',
                fieldId: 'lineuniquekey',
                value: clmKey
            });

            if (pos > -1) so.removeLine({ sublistId: 'item', line: pos });

            // 1 SAVE
            so.save({ enableSourcing: true, ignoreMandatoryFields: false });

            log.audit('SUCCESS', { so: soId, markupLines: eligible.length, po107, assigned });

        } catch (e) {
            log.error('SO EDGE BAND ERROR', { so: context.newRecord.id, message: e.message });
        }
    };

    return { afterSubmit };
});