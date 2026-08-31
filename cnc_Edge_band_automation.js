/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * SO EDGE BAND: trigger line = item 429828 + PO107 CLM_EB.
 * For every other line whose item carries option 9097:
 * set Edge Band = Yes, insert 306264 under it with PO107 + Assigned ID.
 * Then remove the trigger line. 1 load + 1 save.
 */
define(['N/search', 'N/record', 'N/query', 'N/log'], (search, record, query, log) => {

    const CUSTOMER      = '161136';
    const CLM_ITEM      = '429828';
    const MARKUP_ITEM   = '306264';
    const EDGE_OPTION   = '9097';                     // item option internal id
    const EDGE_FIELD    = 'custcol_yy_mod_edgeband';  // line field
    const EDGE_YES      = '1';                        // Yes

    const ITEM_TABLES = [
        'assemblyitem', 'serializedassemblyitem', 'lotnumberedassemblyitem',
        'inventoryitem', 'serializedinventoryitem', 'lotnumberedinventoryitem',
        'kititem',
        'noninventoryitem', 'noninventorysaleitem', 'noninventoryresaleitem',
        'serviceitem', 'servicesaleitem', 'serviceresaleitem',
        'otherchargeitem', 'otherchargesaleitem', 'otherchargeresaleitem'
    ];

    // itemoptions is not searchable - read it with SuiteQL, stop once all ids found
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
            } catch (e) { /* table not in this account */ }
        });

        return edge;
    };


    const LINE_FILTERS = (soId) => ([
        ['internalid', 'anyof', soId], 'AND',
        ['mainline', 'is', 'F'], 'AND',
        ['taxline', 'is', 'F'], 'AND',
        ['cogs', 'is', 'F'], 'AND',
        ['shipping', 'is', 'F']
    ]);


    const afterSubmit = (context) => {

        try {

            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) return;

            const soId = context.newRecord.id;
            if (String(context.newRecord.getValue('entity')) !== CUSTOMER) return;

            const originalTotal = Number(
                String(context.newRecord.getValue('total') || 0).replace(/,/g, '')
            );


            // SEARCH 1 - trigger line: 429828 + CLM_EB
            const clm = search.create({
                type: search.Type.SALES_ORDER,
                filters: LINE_FILTERS(soId).concat([
                    'AND', ['item', 'anyof', CLM_ITEM],
                    'AND', ['custcolproductserviceid_po107', 'is', 'CLM_EB']
                ]),
                columns: ['lineuniquekey', 'custcolassigned_id', 'custcolproductserviceid_po107', 'custcol_product_service_id', 'custcol_edi_unit', 'custcol_ka_po_line_id']
            }).run().getRange({ start: 0, end: 2 });

            if (clm.length !== 1) return;

            const clmKey   = String(clm[0].getValue('lineuniquekey'));
            const assigned = clm[0].getValue('custcolassigned_id');
            const po107    = clm[0].getValue('custcolproductserviceid_po107');
            const productServiceId = clm[0].getValue('custcol_product_service_id');
            const ediUnit          = clm[0].getValue('custcol_edi_unit');
            const poLineId         = clm[0].getValue('custcol_ka_po_line_id');


            // SEARCH 2 - candidate lines
            const lines = [];

            search.create({
                type: search.Type.SALES_ORDER,
                filters: LINE_FILTERS(soId),
                columns: ['item', 'lineuniquekey', 'custcolproductserviceid_po107']
            }).run().each(r => {

                const itemId  = String(r.getValue('item') || '');
                const lineKey = String(r.getValue('lineuniquekey') || '');
                const linePo  = String(r.getValue('custcolproductserviceid_po107') || '');

                // skip trigger line, placeholder, markup and any CLM_EB line
                if (lineKey !== clmKey && itemId !== CLM_ITEM &&
                    itemId !== MARKUP_ITEM && linePo !== 'CLM_EB') {
                    lines.push({ itemId, lineKey });
                }
                return true;
            });

            if (!lines.length) return;


            // which items support edge band
            const edge = getEdgeItems([...new Set(lines.map(l => Number(l.itemId)))]);
            const eligible = lines.filter(l => edge[l.itemId]);

            if (!eligible.length) {
                log.audit('STOP', `SO ${soId} - no Edge Band eligible items`);
                return;
            }


            // 1 LOAD
            const so = record.load({
                type: record.Type.SALES_ORDER,
                id: soId,
                isDynamic: false
            });

            eligible.forEach(l => {

                const src = so.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: l.lineKey
                });

                if (src === -1) return;

                // Edge Band = Yes on the main line
                so.setSublistValue({
                    sublistId: 'item', fieldId: EDGE_FIELD, line: src, value: EDGE_YES
                });

                // markup line directly under it
                const n = src + 1;

                so.insertLine({ sublistId: 'item', line: n });
                so.setSublistValue({ sublistId: 'item', fieldId: 'item', line: n, value: MARKUP_ITEM });

                if (po107) {
                    so.setSublistValue({
                        sublistId: 'item', fieldId: 'custcolproductserviceid_po107', line: n, value: po107
                    });
                }

                if (assigned) {
                    so.setSublistValue({
                        sublistId: 'item', fieldId: 'custcolassigned_id', line: n, value: assigned
                    });
                }

                if (productServiceId) {
                    so.setSublistValue({
                        sublistId: 'item', fieldId: 'custcol_product_service_id', line: n, value: productServiceId
                    });
                }

                if (ediUnit) {
                    so.setSublistValue({
                        sublistId: 'item', fieldId: 'custcol_edi_unit', line: n, value: ediUnit
                    });
                }

                if (poLineId) {
                    so.setSublistValue({
                        sublistId: 'item', fieldId: 'custcol_ka_po_line_id', line: n, value: poLineId
                    });
                }  

                    so.setSublistValue({
                        sublistId: 'item', fieldId: 'description', line: n, value: 'Sales Order Total: ' + originalTotal.toFixed(2)
                    });
                }                            
            });


            // remove the trigger line
            const pos = so.findSublistLineWithValue({
                sublistId: 'item',
                fieldId: 'lineuniquekey',
                value: clmKey
            });

            if (pos === -1) throw Error('Original CLM_EB placeholder line not found');

            so.removeLine({ sublistId: 'item', line: pos });

            // 1 SAVE
            so.save({ enableSourcing: true, ignoreMandatoryFields: false });

            log.audit('SUCCESS', { so: soId, edgeItems: eligible.length, po107, assigned });

        } catch (e) {
            log.error('SO EDGE BAND ERROR', { so: context.newRecord.id, message: e.message });
        }
    };

    return { afterSubmit };
});