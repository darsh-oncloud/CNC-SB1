/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/record', 'N/query', 'N/log'],
    (search, record, query, log) => {

    const CUSTOMER_ID = '161136';
    const MARKUP_ITEM = '306264';
    const EDGE_OPTION = 'CUSTCOL_YY_MOD_EDGEBAND';

    const afterSubmit = (context) => {
        try {

            // CREATE only - prevents rerun after script saves SO
            if (context.type !== context.UserEventType.CREATE) return;

            const soId = context.newRecord.id;
            const customerId = String(
                context.newRecord.getValue({ fieldId: 'entity' })
            );

            // Only required customer
            if (customerId !== CUSTOMER_ID) return;

            log.debug('START', {
                soId,
                customerId
            });


            // =====================================================
            // SEARCH 1
            // Find original CLM_EB line
            // =====================================================
            const clmResults = search.create({
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
                    ['custcolproductserviceid_po107', 'is', 'CLM_EB']
                ],
                columns: [
                    'item',
                    'line',
                    'lineuniquekey',
                    'custcolassigned_id',
                    'custcolproductserviceid_po107'
                ]
            }).run().getRange({
                start: 0,
                end: 2
            });


            log.debug('CLM_EB Count', clmResults.length);


            // Must have EXACTLY one CLM_EB line
            if (clmResults.length !== 1) {

                log.audit('STOP', {
                    reason: 'CLM_EB count is not exactly 1',
                    count: clmResults.length
                });

                return;
            }


            // Values from ORIGINAL line being removed
            const clmLineKey = String(
                clmResults[0].getValue({
                    name: 'lineuniquekey'
                }) || ''
            );

            const clmAssignedId = clmResults[0].getValue({
                name: 'custcolassigned_id'
            });

            const clmPo107 = clmResults[0].getValue({
                name: 'custcolproductserviceid_po107'
            });


            log.debug('Original CLM_EB', {
                item: clmResults[0].getValue({
                    name: 'item'
                }),

                line: clmResults[0].getValue({
                    name: 'line'
                }),

                lineKey: clmLineKey,
                assignedId: clmAssignedId,
                po107: clmPo107
            });


            // =====================================================
            // SEARCH 2
            // Get all other SO item lines
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
                    'line',
                    'lineuniquekey',

                    search.createColumn({
                        name: 'type',
                        join: 'item'
                    })
                ]

            }).run().each(result => {

                const itemId = String(
                    result.getValue({
                        name: 'item'
                    }) || ''
                );

                const lineKey = String(
                    result.getValue({
                        name: 'lineuniquekey'
                    }) || ''
                );

                const itemType = result.getValue({
                    name: 'type',
                    join: 'item'
                });


                // Skip original CLM_EB line
                if (lineKey === clmLineKey) return true;

                // Skip markup item if already there
                if (itemId === MARKUP_ITEM) return true;


                lines.push({
                    itemId,
                    itemType,
                    line: result.getValue({
                        name: 'line'
                    }),
                    lineKey
                });

                return true;
            });


            log.debug('SO Lines Found', {
                count: lines.length,
                lines
            });


            if (!lines.length) {
                log.audit('STOP', 'No item lines found');
                return;
            }


            // =====================================================
            // GET UNIQUE ASSEMBLY ITEM IDs
            // No Item record.load()
            // =====================================================
            const itemIds = [
                ...new Set(
                    lines
                        .filter(x => x.itemType === 'Assembly')
                        .map(x => Number(x.itemId))
                        .filter(Boolean)
                )
            ];


            log.debug('Unique Assembly Items', {
                count: itemIds.length,
                itemIds
            });


            if (!itemIds.length) {
                log.audit('STOP', 'No Assembly items found');
                return;
            }


            // =====================================================
            // ONE SUITEQL QUERY
            // Get itemoptions for ALL items together
            // =====================================================
            const placeholders = itemIds.map(() => '?').join(',');

            const sql = `
                SELECT
                    id,
                    itemoptions
                FROM
                    assemblyitem
                WHERE
                    id IN (${placeholders})
            `;


            const itemResults = query.runSuiteQL({
                query: sql,
                params: itemIds
            }).asMappedResults();


            log.debug('SuiteQL Item Options', {
                count: itemResults.length,
                results: itemResults
            });


            // =====================================================
            // BUILD ELIGIBLE ITEM MAP
            // =====================================================
            const edgeItems = {};

            itemResults.forEach(row => {

                const options = String(
                    row.itemoptions || ''
                ).toUpperCase();

                const hasEdgeBand =
                    options.indexOf(EDGE_OPTION) !== -1;

                edgeItems[String(row.id)] = hasEdgeBand;

                log.debug('Edge Band Check', {
                    item: row.id,
                    options: row.itemoptions,
                    eligible: hasEdgeBand
                });
            });


            // =====================================================
            // GET ELIGIBLE SO LINES
            // =====================================================
            const eligible = lines.filter(line =>
                edgeItems[line.itemId] === true
            );


            log.audit('Eligible Items', {
                count: eligible.length,
                items: eligible
            });


            if (!eligible.length) {
                log.audit(
                    'STOP',
                    'No Edge Band eligible items found'
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
            // ADD MARKUP ITEM BELOW EACH ELIGIBLE ITEM
            // =====================================================
            eligible.forEach(line => {

                const sourceLine =
                    so.findSublistLineWithValue({
                        sublistId: 'item',
                        fieldId: 'lineuniquekey',
                        value: line.lineKey
                    });


                if (sourceLine === -1) {

                    log.error('Source Line Not Found', {
                        item: line.itemId,
                        lineKey: line.lineKey
                    });

                    return;
                }


                const newLine = sourceLine + 1;


                // Insert directly below eligible item
                so.insertLine({
                    sublistId: 'item',
                    line: newLine
                });


                // Add markup item 306264
                so.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: newLine,
                    value: MARKUP_ITEM
                });


                // PO107 FROM ORIGINAL CLM_EB LINE
                if (clmPo107) {

                    so.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolproductserviceid_po107',
                        line: newLine,
                        value: clmPo107
                    });
                }


                // ASSIGNED ID FROM ORIGINAL CLM_EB LINE
                if (clmAssignedId) {

                    so.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolassigned_id',
                        line: newLine,
                        value: clmAssignedId
                    });
                }


                log.audit('Markup Added', {
                    sourceItem: line.itemId,
                    sourceLine: line.line,
                    markupItem: MARKUP_ITEM,
                    assignedId: clmAssignedId,
                    po107: clmPo107
                });

            });


            // =====================================================
            // REMOVE ORIGINAL CLM_EB LINE
            // =====================================================
            const clmPosition =
                so.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: clmLineKey
                });


            if (clmPosition === -1) {

                log.error(
                    'CLM_EB Remove Failed',
                    'Original CLM_EB line not found'
                );

                return;
            }


            so.removeLine({
                sublistId: 'item',
                line: clmPosition
            });


            log.audit('Original CLM_EB Removed', {
                lineKey: clmLineKey,
                assignedId: clmAssignedId,
                po107: clmPo107
            });


            // =====================================================
            // SAVE SALES ORDER ONCE
            // =====================================================
            const savedId = so.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });


            log.audit('SUCCESS', {
                salesOrder: savedId,
                totalSOLines: lines.length,
                uniqueItemsChecked: itemIds.length,
                markupLinesAdded: eligible.length,
                assignedIdCopied: clmAssignedId,
                po107Copied: clmPo107
            });


        } catch (e) {

            log.error('EDGE BAND SCRIPT ERROR', {
                name: e.name,
                message: e.message,
                stack: e.stack
            });
        }
    };


    return {
        afterSubmit
    };

});