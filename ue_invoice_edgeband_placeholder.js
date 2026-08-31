/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * INVOICE - EDGE BAND PLACEHOLDER
 *
 * Find 306264 + CLM_EB lines.
 *
 * If there is exactly ONE unique:
 * Item + PO107 + Assigned ID
 *
 * then:
 *  - sum all matching 306264 amounts
 *  - set all matching 306264 rates to 0
 *  - add one placeholder 429828 with the total amount
 *  - copy PO107 + Assigned ID
 *
 * If more than one unique key exists -> do nothing.
 */
define(['N/search', 'N/record', 'N/log'], (search, record, log) => {

    const CUSTOMER    = '161136';
    const MARKUP_ITEM = '306264';
    const PLACEHOLDER = '429828';

    const afterSubmit = (context) => {

        try {

            if (
                context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT
            ) return;

            const invId = context.newRecord.id;

            if (
                String(context.newRecord.getValue('entity')) !== CUSTOMER
            ) return;


            // -----------------------------------------------------
            // Find only 306264 + CLM_EB lines
            // -----------------------------------------------------
            const lines = [];

            search.create({
                type: search.Type.INVOICE,

                filters: [
                    ['internalid', 'anyof', invId], 'AND',
                    ['mainline', 'is', 'F'], 'AND',
                    ['taxline', 'is', 'F'], 'AND',
                    ['cogs', 'is', 'F'], 'AND',
                    ['shipping', 'is', 'F'], 'AND',
                    ['item', 'anyof', MARKUP_ITEM], 'AND',
                    ['custcolproductserviceid_po107', 'is', 'CLM_EB']
                ],

                columns: [
                    'lineuniquekey',
                    'amount',
                    'custcolproductserviceid_po107',
                    'custcolassigned_id'
                ]

            }).run().each(r => {

                const po107 = String(
                    r.getValue('custcolproductserviceid_po107') || ''
                );

                const assigned = String(
                    r.getValue('custcolassigned_id') || ''
                );

                if (!assigned) return true;

                lines.push({
                    lineKey: String(
                        r.getValue('lineuniquekey') || ''
                    ),

                    amount: Number(
                        String(
                            r.getValue('amount') || 0
                        ).replace(/,/g, '')
                    ),

                    po107,
                    assigned,

                    key: MARKUP_ITEM + '|' + po107 + '|' + assigned
                });

                return true;
            });


            if (!lines.length) return;


            // -----------------------------------------------------
            // How many UNIQUE keys are on this Invoice?
            // -----------------------------------------------------
            const uniqueKeys = [...new Set(
                lines.map(l => l.key)
            )];


            // More than one different key -> do nothing
            if (uniqueKeys.length !== 1) {

                log.audit('STOP', {
                    invoice: invId,
                    reason: 'More than one unique Edge Band key',
                    keys: uniqueKeys
                });

                return;
            }


            // Already processed?
            // All 306264 amounts will be 0 after processing.
            if (lines.every(l => l.amount === 0)) return;


            const totalAmount = lines.reduce(
                (total, l) => total + l.amount,
                0
            );

            const po107 = lines[0].po107;
            const assigned = lines[0].assigned;


            // -----------------------------------------------------
            // Load Invoice once
            // -----------------------------------------------------
            const inv = record.load({
                type: record.Type.INVOICE,
                id: invId,
                isDynamic: false
            });


            // -----------------------------------------------------
            // Set ALL matching 306264 lines = 0
            // -----------------------------------------------------
            lines.forEach(l => {

                const src = inv.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: l.lineKey
                });

                if (src === -1) return;


                inv.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: src,
                    value: 0
                });
            });


            // -----------------------------------------------------
            // Add ONE placeholder with total amount
            // -----------------------------------------------------
            const newLine = inv.getLineCount({
                sublistId: 'item'
            });


            inv.insertLine({
                sublistId: 'item',
                line: newLine
            });


            inv.setSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: newLine,
                value: PLACEHOLDER
            });


            inv.setSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: newLine,
                value: 1
            });


            inv.setSublistValue({
                sublistId: 'item',
                fieldId: 'rate',
                line: newLine,
                value: totalAmount
            });


            inv.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcolproductserviceid_po107',
                line: newLine,
                value: po107
            });


            inv.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcolassigned_id',
                line: newLine,
                value: assigned
            });


            inv.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });


            log.audit('SUCCESS', {
                invoice: invId,
                markupLines: lines.length,
                amount: totalAmount,
                po107,
                assigned
            });


        } catch (e) {

            log.error('INVOICE EDGE BAND ERROR', {
                invoice: context.newRecord.id,
                message: e.message
            });
        }
    };


    return { afterSubmit };

});