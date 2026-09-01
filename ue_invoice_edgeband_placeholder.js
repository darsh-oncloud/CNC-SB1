/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * INVOICE - EDGE BAND PLACEHOLDER
 *
 * Lines = item 306264 + PO107 CLM_EB.
 * All of them must share ONE Assigned ID and none may be blank, else stop.
 *
 * Then: read the SO total from the Boomi field, set every line rate = 0 and
 * put its old amount in the Boomi field, and add one 429828 placeholder whose
 * amount brings the invoice total back to the SO total.
 *
 * 1 search + 1 load + 1 save.
 */
define(['N/search', 'N/record', 'N/log'], (search, record, log) => {

    const CUSTOMER    = '161136';
    const MARKUP_ITEM = '306264';
    const PLACEHOLDER = '429828';
    const BOOMI_FIELD = 'custcol_boomi_edi_item_details';
    const TOLERANCE   = 0.01;

    const toAmount = (v) => Number(String(v || '').replace(/[^0-9.\-]/g, '')) || 0;

    const afterSubmit = (context) => {

        try {

            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) return;

            const invId = context.newRecord.id;
            if (String(context.newRecord.getValue('entity')) !== CUSTOMER) return;


            // -----------------------------------------------------
            // 306264 + CLM_EB lines (placeholder included, to detect a re-run)
            // -----------------------------------------------------
            const lines = [];
            let done = false;

            search.create({
                type: search.Type.INVOICE,
                filters: [
                    ['internalid', 'anyof', invId], 'AND',
                    ['mainline', 'is', 'F'], 'AND',
                    ['taxline', 'is', 'F'], 'AND',
                    ['cogs', 'is', 'F'], 'AND',
                    ['shipping', 'is', 'F'], 'AND',
                    ['item', 'anyof', [MARKUP_ITEM, PLACEHOLDER]], 'AND',
                    ['custcolproductserviceid_po107', 'is', 'CLM_EB']
                ],
                columns: [
                    'item', 'lineuniquekey', 'amount',
                    'custcolassigned_id', BOOMI_FIELD
                ]
            }).run().each(r => {

                if (String(r.getValue('item') || '') === PLACEHOLDER) {
                    done = true;
                    return true;
                }

                lines.push({
                    lineKey: String(r.getValue('lineuniquekey') || ''),
                    amount: toAmount(r.getValue('amount')),
                    boomi: String(r.getValue(BOOMI_FIELD) || ''),
                    assigned: String(r.getValue('custcolassigned_id') || '')
                });

                return true;
            });

            if (done) {
                log.audit('STOP', { invoice: invId, reason: 'Placeholder already exists' });
                return;
            }

            if (!lines.length) return;


            // -----------------------------------------------------
            // One Assigned ID for all lines, none blank
            // -----------------------------------------------------
            const ids = [...new Set(lines.map(l => l.assigned))];

            if (ids.length !== 1 || !ids[0]) {
                log.audit('STOP', {
                    invoice: invId,
                    reason: 'Assigned ID is blank or not the same on all lines',
                    ids
                });
                return;
            }

            const assigned = ids[0];


            // -----------------------------------------------------
            // Amounts
            // -----------------------------------------------------
            const invoiceTotal = toAmount(
                search.lookupFields({
                    type: search.Type.INVOICE, id: invId, columns: ['total']
                }).total
            );

            const soLine    = lines.filter(l => l.boomi)[0];
            const soTotal   = soLine ? toAmount(soLine.boomi) : 0;
            const markupSum = lines.reduce((t, l) => t + l.amount, 0);

            // amount that puts the invoice total back on the SO total
            let amount = soTotal > 0
                ? Number((soTotal - (invoiceTotal - markupSum)).toFixed(2))
                : markupSum;

            if (amount < 0) {
                log.error('NEGATIVE PLACEHOLDER', { invoice: invId, soTotal, invoiceTotal, markupSum });
                amount = markupSum;
            }

            const matched = Math.abs(amount - markupSum) <= TOLERANCE;

            const note = 'Sales Order Total: ' + soTotal.toFixed(2) +
                ' | Invoice Total: ' + invoiceTotal.toFixed(2) +
                (soTotal > 0
                    ? (matched ? ' | MATCHED' : ' | ADJUSTED to ' + amount.toFixed(2))
                    : ' | NO SO TOTAL FOUND');


            // -----------------------------------------------------
            // 1 LOAD
            // -----------------------------------------------------
            const inv = record.load({
                type: record.Type.INVOICE, id: invId, isDynamic: false
            });

            lines.forEach(l => {

                const src = inv.findSublistLineWithValue({
                    sublistId: 'item', fieldId: 'lineuniquekey', value: l.lineKey
                });

                if (src === -1) return;

                inv.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: src, value: 0 });

                inv.setSublistValue({
                    sublistId: 'item', fieldId: BOOMI_FIELD, line: src, value: l.amount.toFixed(2)
                });
            });

            const n = inv.getLineCount({ sublistId: 'item' });

            inv.insertLine({ sublistId: 'item', line: n });
            inv.setSublistValue({ sublistId: 'item', fieldId: 'item', line: n, value: PLACEHOLDER });
            inv.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: n, value: 1 });
            inv.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: n, value: amount });
            inv.setSublistValue({
                sublistId: 'item', fieldId: 'custcolproductserviceid_po107', line: n, value: 'CLM_EB'
            });
            inv.setSublistValue({
                sublistId: 'item', fieldId: 'custcolassigned_id', line: n, value: assigned
            });
            inv.setSublistValue({ sublistId: 'item', fieldId: BOOMI_FIELD, line: n, value: note });

            // 1 SAVE
            inv.save({ enableSourcing: true, ignoreMandatoryFields: false });

            log.audit('SUCCESS', {
                invoice: invId, lines: lines.length, markupSum,
                placeholder: amount, soTotal, invoiceTotal, matched, assigned
            });

        } catch (e) {
            log.error('INVOICE EDGE BAND ERROR', {
                invoice: context.newRecord.id, message: e.message
            });
        }
    };

    return { afterSubmit };
});