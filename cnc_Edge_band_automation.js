/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * SALES ORDER - EDGE BAND MARKUP
 *
 * Trigger:
 *   Item 429828 + PO107 = CLM_EB
 *
 * Process:
 *   1. Find items eligible for Edge Band option 9097
 *   2. Set custcol_yy_mod_edgeband = Yes on eligible MAIN item
 *   3. Add markup item 306264 directly underneath
 *   4. Copy PO107 + Assigned ID from original CLM_EB placeholder
 *   5. Remove original placeholder item 429828
 */
define(['N/search', 'N/record', 'N/query', 'N/log'],
(search, record, query, log) => {

    const CUSTOMER    = '161136';
    const CLM_ITEM    = '429828';
    const MARKUP_ITEM = '306264';
    const EDGE_OPTION = '9097';

    // Transaction Item Option field
    const EDGE_FIELD = 'custcol_yy_mod_edgeband';

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
    // Find items that have Edge Band Item Option 9097
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

                    const options = String(row.itemoptions || '')
                        .split(',')
                        .map(v => v.trim());

                    if (options.includes(EDGE_OPTION)) {
                        edge[String(row.id)] = true;
                    }

                    left = left.filter(
                        id => id !== Number(row.id)
                    );
                });

            } catch (e) {
                // Continue to next item type
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
            ) return;


            const soId = context.newRecord.id;

            if (
                String(
                    context.newRecord.getValue({
                        fieldId: 'entity'
                    })
                ) !== CUSTOMER
            ) return;


            // =====================================================
            // SEARCH 1
            // Trigger ONLY when:
            // Item = 429828
            // PO107 = CLM_EB
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


            // Must have exactly one placeholder
            if (clm.length !== 1) return;


            const clmKey = String(
                clm[0].getValue({
                    name: 'lineuniquekey'
                }) || ''
            );

            const assigned = clm[0].getValue({
                name: 'custcolassigned_id'
            });

            const po107 = clm[0].getValue({
                name: 'custcolproductserviceid_po107'
            });


            // =====================================================
            // SEARCH 2
            // Get possible main items
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
                    'lineuniquekey'
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


                // Do not consider:
                // Original placeholder
                // Markup item
                if (
                    lineKey !== clmKey &&
                    itemId !== CLM_ITEM &&
                    itemId !== MARKUP_ITEM
                ) {

                    lines.push({
                        itemId,
                        lineKey
                    });
                }

                return true;
            });


            if (!lines.length) return;


            // =====================================================
            // CHECK WHICH ITEMS SUPPORT EDGE BAND
            // =====================================================
            const itemIds = [
                ...new Set(
                    lines.map(x => Number(x.itemId))
                )
            ];

            const edgeItems = getEdgeItems(itemIds);

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
            // PROCESS ELIGIBLE ITEMS
            // =====================================================
            eligible.forEach(line => {

                const src = so.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: line.lineKey
                });


                if (src === -1) return;


                // -------------------------------------------------
                // NEW CHANGE:
                // Set EDGE BAND = YES on MAIN eligible item
                // -------------------------------------------------
                so.setSublistText({
                    sublistId: 'item',
                    fieldId: EDGE_FIELD,
                    line: src,
                    text: 'Yes'
                });


                // -------------------------------------------------
                // Add markup directly underneath
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
            // REMOVE ORIGINAL 429828 + CLM_EB PLACEHOLDER
            // =====================================================
            const pos = so.findSublistLineWithValue({
                sublistId: 'item',
                fieldId: 'lineuniquekey',
                value: clmKey
            });


            if (pos === -1) {
                throw Error('Original CLM_EB placeholder not found');
            }


            so.removeLine({
                sublistId: 'item',
                line: pos
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
                edgeBandItems: eligible.length,
                markupLines: eligible.length,
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


    return { afterSubmit };

});