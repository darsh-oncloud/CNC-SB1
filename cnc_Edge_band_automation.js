/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/record', 'N/query', 'N/log'],
(search, record, query, log) => {

    const CUSTOMER    = '161136';
    const CLM_ITEM    = '429828';
    const MARKUP_ITEM = '306264';

    const EDGE_OPTION_ID    = '9097'; // Item option internal ID
    const EDGE_LINE_FIELD   = 'custcol_yy_mod_edgeband';
    const EDGE_YES_VALUE    = '1';    // Field Explorer shows Yes = "1"


    const ITEM_TABLES = [
        'assemblyitem',
        'serializedassemblyitem',
        'lotnumberedassemblyitem',
        'inventoryitem',
        'serializedinventoryitem',
        'lotnumberedinventoryitem',
        'kititem',
        'noninventoryitem',
        'noninventorysaleitem',
        'noninventoryresaleitem',
        'serviceitem',
        'servicesaleitem',
        'serviceresaleitem',
        'otherchargeitem',
        'otherchargesaleitem',
        'otherchargeresaleitem'
    ];


    // ---------------------------------------------------------
    // Find which items have Edge Band option 9097
    // ---------------------------------------------------------
    const getEdgeItems = ids => {

        const edge = {};
        let left = ids.slice();

        ITEM_TABLES.forEach(table => {

            if (!left.length) return;

            try {

                const rows = query.runSuiteQL({
                    query:
                        `SELECT id, itemoptions
                         FROM ${table}
                         WHERE id IN (${left.join(',')})`
                }).asMappedResults();


                rows.forEach(row => {

                    const id = String(row.id);

                    const options = String(row.itemoptions || '')
                        .split(',')
                        .map(v => v.trim());


                    if (options.includes(EDGE_OPTION_ID)) {
                        edge[id] = true;
                    }


                    left = left.filter(
                        itemId => itemId !== Number(row.id)
                    );
                });

            } catch (e) {
                // Continue with next item table
            }
        });


        return edge;
    };


    const afterSubmit = context => {

        try {

            // CREATE + EDIT
            if (
                context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT
            ) {
                return;
            }


            const soId = context.newRecord.id;

            const customer = String(
                context.newRecord.getValue({
                    fieldId: 'entity'
                })
            );


            if (customer !== CUSTOMER) return;



            // =====================================================
            // SEARCH 1
            // Trigger ONLY:
            // Item 429828 + PO107 = CLM_EB
            // =====================================================
            const clm = search.create({

                type: search.Type.SALES_ORDER,

                filters: [

                    ['internalid', 'anyof', soId],
                    'AND',

                    ['mainline', 'is', 'F'],
                    'AND',

                    ['taxline', 'is', 'F'],
                    'AND',

                    ['cogs', 'is', 'F'],
                    'AND',

                    ['shipping', 'is', 'F'],
                    'AND',

                    ['item', 'anyof', CLM_ITEM],
                    'AND',

                    ['custcolproductserviceid_po107', 'is', 'CLM_EB']
                ],

                columns: [
                    'lineuniquekey',
                    'custcolassigned_id',
                    'custcolproductserviceid_po107'
                ]

            }).run().getRange({
                start: 0,
                end: 2
            });


            // Must have exactly one original placeholder
            if (clm.length !== 1) return;


            const clmKey = String(
                clm[0].getValue({
                    name: 'lineuniquekey'
                })
            );


            const assigned = clm[0].getValue({
                name: 'custcolassigned_id'
            });


            const po107 = clm[0].getValue({
                name: 'custcolproductserviceid_po107'
            });



            // =====================================================
            // SEARCH 2
            // Get possible Edge Band source items
            // =====================================================
            const lines = [];


            search.create({

                type: search.Type.SALES_ORDER,

                filters: [

                    ['internalid', 'anyof', soId],
                    'AND',

                    ['mainline', 'is', 'F'],
                    'AND',

                    ['taxline', 'is', 'F'],
                    'AND',

                    ['cogs', 'is', 'F'],
                    'AND',

                    ['shipping', 'is', 'F']
                ],

                columns: [
                    'item',
                    'lineuniquekey',
                    'custcolproductserviceid_po107'
                ]

            }).run().each(r => {


                const itemId = String(
                    r.getValue({
                        name: 'item'
                    }) || ''
                );


                const lineKey = String(
                    r.getValue({
                        name: 'lineuniquekey'
                    }) || ''
                );


                const linePo107 = String(
                    r.getValue({
                        name: 'custcolproductserviceid_po107'
                    }) || ''
                );


                // Skip:
                // original placeholder
                // markup item
                // any CLM_EB line
                if (
                    lineKey === clmKey ||
                    itemId === CLM_ITEM ||
                    itemId === MARKUP_ITEM ||
                    linePo107 === 'CLM_EB'
                ) {
                    return true;
                }


                lines.push({
                    itemId,
                    lineKey
                });


                return true;
            });


            if (!lines.length) return;



            // =====================================================
            // CHECK WHICH ITEMS SUPPORT EDGE BAND
            // =====================================================
            const uniqueIds = [
                ...new Set(
                    lines.map(line => Number(line.itemId))
                )
            ];


            const edgeItems = getEdgeItems(uniqueIds);


            const eligible = lines.filter(
                line => edgeItems[line.itemId]
            );


            if (!eligible.length) {

                log.audit(
                    'STOP',
                    `SO ${soId} - no Edge Band eligible items`
                );

                return;
            }



            // =====================================================
            // LOAD SALES ORDER ONCE
            // =====================================================
            const so = record.load({
                type: record.Type.SALES_ORDER,
                id: soId,
                isDynamic: false
            });



            // =====================================================
            // PROCESS EACH ELIGIBLE MAIN ITEM
            // =====================================================
            eligible.forEach(line => {


                const src = so.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: line.lineKey
                });


                if (src === -1) return;



                // -------------------------------------------------
                // NEW:
                // Set Edge Band = Yes on MAIN eligible item
                // -------------------------------------------------
                so.setSublistValue({
                    sublistId: 'item',
                    fieldId: EDGE_LINE_FIELD,
                    line: src,
                    value: EDGE_YES_VALUE
                });



                // -------------------------------------------------
                // Add markup item directly underneath
                // -------------------------------------------------
                const newLine = src + 1;


                so.insertLine({
                    sublistId: 'item',
                    line: newLine
                });


                so.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: newLine,
                    value: MARKUP_ITEM
                });



                // PO107 from original placeholder
                if (po107) {

                    so.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolproductserviceid_po107',
                        line: newLine,
                        value: po107
                    });
                }



                // Assigned ID from original placeholder
                if (assigned) {

                    so.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolassigned_id',
                        line: newLine,
                        value: assigned
                    });
                }

            });



            // =====================================================
            // REMOVE ORIGINAL PLACEHOLDER
            // 429828 + CLM_EB
            // =====================================================
            const clmPosition =
                so.findSublistLineWithValue({

                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: clmKey

                });


            if (clmPosition === -1) {

                throw Error(
                    'Original CLM_EB placeholder line not found'
                );
            }


            so.removeLine({
                sublistId: 'item',
                line: clmPosition
            });



            // =====================================================
            // SAVE ONCE
            // =====================================================
            so.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });



            log.audit('SUCCESS', {
                so: soId,
                edgeItemsUpdated: eligible.length,
                markupLinesAdded: eligible.length,
                po107,
                assigned
            });


        } catch (e) {

            log.error('SO EDGE BAND ERROR', {
                so: context.newRecord.id,
                message: e.message
            });
        }
    };


    return {
        afterSubmit
    };

});