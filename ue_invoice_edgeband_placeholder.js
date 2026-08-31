/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * INVOICE - EDGE BAND PLACEHOLDER
 *
 * 1. Find 306264 + CLM_EB lines.
 * 2. Only ONE unique Item + PO107 + Assigned ID key allowed, else stop.
 * 3. Read the SO total out of custcol_boomi_edi_item_details BEFORE clearing it.
 * 4. Set every matching 306264 line rate = 0 and blank its Boomi field.
 * 5. Sum the old amounts, add one 429828 placeholder line with that total.
 * 6. Compare invoice total against the SO total and note the result in the
 *    Boomi field on the new line.
 *
 * 1 search + 1 load + 1 save.
 */
define(['N/search', 'N/record', 'N/log'], (search, record, log) => {

    const CUSTOMER    = '161136';
    const MARKUP_ITEM = '306264';
    const PLACEHOLDER = '429828';
    const BOOMI_FIELD = 'custcol_boomi_edi_item_details';
    const TOLERANCE   = 0.01;      // rounding allowance on the total comparison

    // pull the number out of "Sales Order Total: 1234.56"
    const toAmount = (v) => Number(String(v || '').replace(/[^0-9.\-]/g, '')) || 0;

    const afterSubmit = (context) => {

        try {

            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) return;

            const invId = context.newRecord.id;
            if (String(context.newRecord.getValue('entity')) !== CUSTOMER) return;

            const invoiceTotal = toAmount(context.newRecord.getValue('total'));


            // -----------------------------------------------------
            // 306264 + CLM_EB lines
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
                    'lineuniquekey', 'amount',
                    'custcolproductserviceid_po107', 'custcolassigned_id',
                    BOOMI_FIELD
                ]
            }).run().each(r => {

                const po107    = String(r.getValue('custcolproductserviceid_po107') || '');
                const assigned = String(r.getValue('custcolassigned_id') || '');

                if (!assigned) return true;

                lines.push({
                    lineKey: String(r.getValue('lineuniquekey') || ''),
                    amount: toAmount(r.getValue('amount')),
                    boomi: String(r.getValue(BOOMI_FIELD) || ''),
                    po107,
                    assigned,
                    key: MARKUP_ITEM + '|' + po107 + '|' + assigned
                });

                return true;
            });

            if (!lines.length) return;


            // one unique key only
            const uniqueKeys = [...new Set(lines.map(l => l.key))];

            if (uniqueKeys.length !== 1) {
                log.audit('STOP', {
                    invoice: invId,
                    reason: 'More than one unique Edge Band key',
                    keys: uniqueKeys
                });
                return;
            }

            // already processed - every markup line is at 0
            if (lines.every(l => l.amount === 0)) return;


            // -----------------------------------------------------
            // SO total captured BEFORE the field is cleared
            // -----------------------------------------------------
            const soLine  = lines.filter(l => l.boomi)[0];
            const soTotal = soLine ? toAmount(soLine.boomi) : 0;

            const totalAmount = lines.reduce((t, l) => t + l.amount, 0);

            const matched = soTotal > 0 &&
                Math.abs(invoiceTotal - soTotal) <= TOLERANCE;

            const note = 'Sales Order Total: ' + soTotal.toFixed(2) +
                ' | Invoice Total: ' + invoiceTotal.toFixed(2) +
                (soTotal > 0
                    ? (matched ? ' | MATCHED' : ' | NOT MATCHED')
                    : ' | NO SO TOTAL FOUND');

            if (!matched) {
                log.audit('TOTAL MISMATCH', {
                    invoice: invId, soTotal, invoiceTotal
                });
            }

            const po107    = lines[0].po107;
            const assigned = lines[0].assigned;


            // -----------------------------------------------------
            // 1 LOAD
            // -----------------------------------------------------
            const inv = record.load({
                type: record.Type.INVOICE,
                id: invId,
                isDynamic: false
            });

            // rate 0 + clear the Boomi field on every matching line
            lines.forEach(l => {

                const src = inv.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: l.lineKey
                });

                if (src === -1) return;

                inv.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: src, value: 0 });
                inv.setSublistValue({ sublistId: 'item', fieldId: BOOMI_FIELD, line: src, value: '' });
            });


            // one placeholder line with the combined amount
            const n = inv.getLineCount({ sublistId: 'item' });

            inv.insertLine({ sublistId: 'item', line: n });

            inv.setSublistValue({ sublistId: 'item', fieldId: 'item', line: n, value: PLACEHOLDER });
            inv.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: n, value: 1 });
            inv.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: n, value: totalAmount });

            inv.setSublistValue({
                sublistId: 'item', fieldId: 'custcolproductserviceid_po107', line: n, value: po107
            });

            inv.setSublistValue({
                sublistId: 'item', fieldId: 'custcolassigned_id', line: n, value: assigned
            });

            inv.setSublistValue({
                sublistId: 'item', fieldId: BOOMI_FIELD, line: n, value: note
            });


            // 1 SAVE
            inv.save({ enableSourcing: true, ignoreMandatoryFields: false });

            log.audit('SUCCESS', {
                invoice: invId,
                markupLines: lines.length,
                amount: totalAmount,
                soTotal,
                invoiceTotal,
                matched,
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