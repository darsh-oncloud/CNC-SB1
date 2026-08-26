/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/record', 'N/log'], (search, record, log) => {

    const CUSTOMER_ID = '161136';
    const MARKUP_ITEM = '306264';

    const EDGE_OPTION_ID = '9097';
    const EDGE_OPTION_SCRIPT_ID = 'CUSTCOL_YY_MOD_EDGEBAND';

    const afterSubmit = (context) => {
        try {
            // CREATE only - prevents re-running when this script saves the SO
            if (context.type !== context.UserEventType.CREATE) return;

            const soId = context.newRecord.id;
            const customerId = String(context.newRecord.getValue({ fieldId: 'entity' }));

            if (customerId !== CUSTOMER_ID) return;

            log.debug('START', { soId, customerId });

            // =====================================================
            // SEARCH 1 - Find the ONE original CLM_EB line
            // =====================================================
            const clmSearch = search.create({
                type: search.Type.SALES_ORDER,
                filters: [
                    ['internalid', 'anyof', soId],
                    'AND', ['mainline', 'is', 'F'],
                    'AND', ['taxline', 'is', 'F'],
                    'AND', ['cogs', 'is', 'F'],
                    'AND', ['shipping', 'is', 'F'],
                    'AND', ['custcolproductserviceid_po107', 'is', 'CLM_EB']
                ],
                columns: [
                    'item',
                    'line',
                    'lineuniquekey',
                    'custcolassigned_id'
                ]
            });

            const clmResults = clmSearch.run().getRange({
                start: 0,
                end: 2
            });

            log.debug('CLM_EB Count', clmResults.length);

            // Must be exactly ONE
            if (clmResults.length !== 1) {
                log.audit('STOP', 'CLM_EB count is not exactly 1');
                return;
            }

            const clmLineKey = String(
                clmResults[0].getValue({ name: 'lineuniquekey' })
            );

            log.debug('Original CLM_EB', {
                item: clmResults[0].getValue({ name: 'item' }),
                line: clmResults[0].getValue({ name: 'line' }),
                lineKey: clmLineKey
            });


            // =====================================================
            // SEARCH 2 - Get all item lines on this SO
            // =====================================================
            const lines = [];

            search.create({
                type: search.Type.SALES_ORDER,
                filters: [
                    ['internalid', 'anyof', soId],
                    'AND', ['mainline', 'is', 'F'],
                    'AND', ['taxline', 'is', 'F'],
                    'AND', ['cogs', 'is', 'F'],
                    'AND', ['shipping', 'is', 'F']
                ],
                columns: [
                    'item',
                    'line',
                    'lineuniquekey',
                    'custcolassigned_id',
                    'custcolproductserviceid_po107'
                ]
            }).run().each(result => {

                const lineKey = String(
                    result.getValue({ name: 'lineuniquekey' })
                );

                const itemId = String(
                    result.getValue({ name: 'item' }) || ''
                );

                // Skip original CLM_EB and markup item
                if (lineKey === clmLineKey || itemId === MARKUP_ITEM) return true;

                lines.push({
                    itemId: itemId,
                    line: result.getValue({ name: 'line' }),
                    lineKey: lineKey,
                    assignedId: result.getValue({
                        name: 'custcolassigned_id'
                    })
                });

                return true;
            });

            log.debug('SO Lines Found', lines);


            // =====================================================
            // CHECK ITEM OPTIONS - No Item record.load()
            // =====================================================
            const eligible = [];

            lines.forEach(line => {

                const lookup = search.lookupFields({
                    type: search.Type.ITEM,
                    id: line.itemId,
                    columns: ['itemoptions']
                });

                const options = lookup.itemoptions || [];

                const hasEdgeBand = options.some(option => {
                    const value = String(option.value !== undefined ? option.value : option).toUpperCase();

                    return value === EDGE_OPTION_ID ||
                           value === EDGE_OPTION_SCRIPT_ID;
                });

                log.debug('Edge Band Check', {
                    item: line.itemId,
                    line: line.line,
                    options: options,
                    eligible: hasEdgeBand
                });

                if (hasEdgeBand) eligible.push(line);
            });


            if (!eligible.length) {
                log.audit('STOP', 'No Edge Band eligible items found');
                return;
            }

            log.audit('Eligible Items', eligible);


            // =====================================================
            // LOAD SO ONCE
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

                const position = so.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: line.lineKey
                });

                if (position === -1) {
                    log.error('Line Not Found', line);
                    return;
                }

                so.insertLine({
                    sublistId: 'item',
                    line: position + 1
                });

                so.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: position + 1,
                    value: MARKUP_ITEM
                });

                so.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcolproductserviceid_po107',
                    line: position + 1,
                    value: 'CLM_EB'
                });

                if (line.assignedId) {
                    so.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolassigned_id',
                        line: position + 1,
                        value: line.assignedId
                    });
                }

                log.audit('Markup Added', {
                    sourceItem: line.itemId,
                    sourceLine: line.line,
                    markupItem: MARKUP_ITEM,
                    assignedId: line.assignedId
                });
            });


            // =====================================================
            // REMOVE ORIGINAL CLM_EB LINE
            // =====================================================
            const clmPosition = so.findSublistLineWithValue({
                sublistId: 'item',
                fieldId: 'lineuniquekey',
                value: clmLineKey
            });

            if (clmPosition === -1) {
                log.error('CLM_EB Remove Failed', 'Original line not found');
                return;
            }

            so.removeLine({
                sublistId: 'item',
                line: clmPosition
            });

            log.audit('Original CLM_EB Removed', {
                lineKey: clmLineKey
            });


            // =====================================================
            // SAVE
            // =====================================================
            const savedId = so.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });

            log.audit('SUCCESS', {
                salesOrder: savedId,
                markupLinesAdded: eligible.length
            });

        } catch (e) {
            log.error('EDGE BAND SCRIPT ERROR', {
                name: e.name,
                message: e.message,
                stack: e.stack
            });
        }
    };

    return { afterSubmit };
});
