/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/record', 'N/log'], (search, record, log) => {

    const CUSTOMER_ID = '161136';
    const MARKUP_ITEM = '306264';
    const EDGE_OPTION = 'CUSTCOL_YY_MOD_EDGEBAND';

    const afterSubmit = (context) => {
        try {

            // CREATE only - prevents script from running again after SO save
            if (context.type !== context.UserEventType.EDIT) return;

            const soId = context.newRecord.id;
            const customerId = String(
                context.newRecord.getValue({ fieldId: 'entity' })
            );

            // Only this customer
            if (customerId !== CUSTOMER_ID) return;

            log.debug('START', {
                soId: soId,
                customerId: customerId
            });


            // =========================================================
            // SEARCH 1
            // Find original CLM_EB line
            // =========================================================
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
                    'custcolassigned_id'
                ]
            }).run().getRange({
                start: 0,
                end: 2
            });

            log.debug('CLM_EB Count', clmResults.length);

            // Must have exactly 1 CLM_EB line
            if (clmResults.length !== 1) {
                log.audit('STOP', 'CLM_EB count is not exactly 1');
                return;
            }

            const clmLineKey = String(
                clmResults[0].getValue({
                    name: 'lineuniquekey'
                })
            );

            log.debug('Original CLM_EB', {
                item: clmResults[0].getValue({ name: 'item' }),
                line: clmResults[0].getValue({ name: 'line' }),
                lineKey: clmLineKey
            });


            // =========================================================
            // SEARCH 2
            // Get all other item lines on SO
            // =========================================================
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
                    'custcolassigned_id',

                    search.createColumn({
                        name: 'type',
                        join: 'item'
                    })
                ]
            }).run().each(result => {

                const itemId = String(
                    result.getValue({ name: 'item' }) || ''
                );

                const lineKey = String(
                    result.getValue({
                        name: 'lineuniquekey'
                    }) || ''
                );

                // Skip original CLM_EB line
                if (lineKey === clmLineKey) return true;

                // Skip markup item if already present
                if (itemId === MARKUP_ITEM) return true;

                lines.push({
                    itemId: itemId,

                    itemType: result.getValue({
                        name: 'type',
                        join: 'item'
                    }),

                    line: result.getValue({
                        name: 'line'
                    }),

                    lineKey: lineKey,

                    assignedId: result.getValue({
                        name: 'custcolassigned_id'
                    })
                });

                return true;
            });

            log.debug('SO Lines Found', lines);


            // =========================================================
            // ITEM TYPE MAP
            // =========================================================
            const typeMap = {
                InvtPart: record.Type.INVENTORY_ITEM,
                Assembly: record.Type.ASSEMBLY_ITEM,
                NonInvtPart: record.Type.NON_INVENTORY_ITEM,
                Service: record.Type.SERVICE_ITEM,
                OthCharge: record.Type.OTHER_CHARGE_ITEM,
                Kit: record.Type.KIT_ITEM
            };


            // =========================================================
            // CHECK EDGE BAND OPTION
            // Load each UNIQUE item only once
            // =========================================================
            const eligible = [];
            const checkedItems = {};

            lines.forEach(line => {

                if (checkedItems[line.itemId] === undefined) {

                    const recordType = typeMap[line.itemType];

                    if (!recordType) {

                        log.error('Unsupported Item Type', {
                            item: line.itemId,
                            type: line.itemType
                        });

                        checkedItems[line.itemId] = false;

                    } else {

                        const itemRec = record.load({
                            type: recordType,
                            id: line.itemId,
                            isDynamic: false
                        });

                        let options = itemRec.getValue({
                            fieldId: 'itemoptions'
                        }) || [];

                        if (!Array.isArray(options)) {
                            options = String(options).split(',');
                        }

                        const hasEdgeBand = options.some(option =>
                            String(option).trim().toUpperCase() === EDGE_OPTION
                        );

                        checkedItems[line.itemId] = hasEdgeBand;

                        log.debug('Edge Band Check', {
                            item: line.itemId,
                            type: line.itemType,
                            options: options,
                            eligible: hasEdgeBand
                        });
                    }
                }

                if (checkedItems[line.itemId]) {
                    eligible.push(line);
                }
            });


            log.audit('Eligible Items', eligible);

            if (!eligible.length) {
                log.audit('STOP', 'No Edge Band eligible items found');
                return;
            }


            // =========================================================
            // LOAD SALES ORDER ONCE
            // =========================================================
            const so = record.load({
                type: record.Type.SALES_ORDER,
                id: soId,
                isDynamic: false
            });


            // =========================================================
            // ADD MARKUP ITEM UNDER EACH ELIGIBLE ITEM
            // =========================================================
            eligible.forEach(line => {

                const sourceLine = so.findSublistLineWithValue({
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


                // Insert directly below eligible item
                const newLine = sourceLine + 1;

                so.insertLine({
                    sublistId: 'item',
                    line: newLine
                });


                // Markup Item
                so.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: newLine,
                    value: MARKUP_ITEM
                });


                // PO107 = CLM_EB
                so.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcolproductserviceid_po107',
                    line: newLine,
                    value: 'CLM_EB'
                });


                // Copy Assigned ID from eligible item
                if (line.assignedId) {

                    so.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolassigned_id',
                        line: newLine,
                        value: line.assignedId
                    });
                }


                log.audit('Markup Added', {
                    sourceItem: line.itemId,
                    sourceLine: line.line,
                    sourceLineKey: line.lineKey,
                    markupItem: MARKUP_ITEM,
                    assignedId: line.assignedId
                });

            });


            // =========================================================
            // REMOVE ORIGINAL CLM_EB LINE
            // =========================================================
            const clmPosition = so.findSublistLineWithValue({
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
                position: clmPosition
            });


            // =========================================================
            // SAVE SO
            // =========================================================
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


    return {
        afterSubmit: afterSubmit
    };

});