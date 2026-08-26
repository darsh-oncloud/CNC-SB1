/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * INVOICE - EDGE BAND PLACEHOLDER
 *
 * For every 306264 line whose PO107 + Assigned ID key appears ONLY ONCE:
 *   set that 306264 line rate = 0
 *   insert the placeholder item right below it with the same amount,
 *   same PO107 and same Assigned ID.
 * If the same key appears more than once -> those lines are skipped.
 * Invoice total never changes.
 *
 * No item load, no SuiteQL, no item option check here.
 */
define(['N/search', 'N/record', 'N/log'], (search, record, log) => {

    const CUSTOMER    = '161136';
    const MARKUP_ITEM = '306264';
    const PLACEHOLDER = '429828';      // <-- confirm placeholder item internal id

    const afterSubmit = (context) => {

        try {

            if (context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT) return;

            const invId = context.newRecord.id;

            if (String(context.newRecord.getValue('entity')) !== CUSTOMER) return;


            // SEARCH - only item 306264 lines
            const lines = [];

            search.create({
                type: search.Type.INVOICE,
                filters: [
                    ['internalid', 'anyof', invId], 'AND',
                    ['mainline', 'is', 'F'], 'AND',
                    ['taxline', 'is', 'F'], 'AND',
                    ['cogs', 'is', 'F'], 'AND',
                    ['shipping', 'is', 'F'], 'AND',
                    ['item', 'anyof', MARKUP_ITEM]
                ],
                columns: ['lineuniquekey', 'amount',
                          'custcolproductserviceid_po107', 'custcolassigned_id']
            }).run().each(r => {

                const po107    = String(r.getValue('custcolproductserviceid_po107') || '');
                const assigned = String(r.getValue('custcolassigned_id') || '');

                lines.push({
                    lineKey: String(r.getValue('lineuniquekey') || ''),
                    amount: Number(String(r.getValue('amount') || 0).replace(/,/g, '')),
                    po107,
                    assigned,
                    key: po107 + '|' + assigned
                });
                return true;
            });

            if (!lines.length) return;


            // count PO107 + Assigned ID
            const counts = {};
            lines.forEach(l => { counts[l.key] = (counts[l.key] || 0) + 1; });

            // unique key + still has an amount (amount 0 = already processed on a re-save)
            const valid = lines.filter(l =>
                l.po107 && l.assigned && counts[l.key] === 1 && l.amount !== 0
            );

            if (!valid.length) {
                log.audit('STOP', 'Invoice ' + invId + ' - duplicate keys or already processed');
                return;
            }


            // 1 LOAD
            const inv = record.load({
                type: record.Type.INVOICE,
                id: invId,
                isDynamic: false
            });

            valid.forEach(l => {

                const src = inv.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: l.lineKey
                });

                if (src === -1) return;

                inv.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: src, value: 0 });

                const n = src + 1;

                inv.insertLine({ sublistId: 'item', line: n });
                inv.setSublistValue({ sublistId: 'item', fieldId: 'item', line: n, value: PLACEHOLDER });
                inv.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: n, value: 1 });
                inv.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: n, value: l.amount });
                inv.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcolproductserviceid_po107',
                    line: n,
                    value: l.po107
                });
                inv.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcolassigned_id',
                    line: n,
                    value: l.assigned
                });
            });

            // 1 SAVE
            inv.save({ enableSourcing: true, ignoreMandatoryFields: false });

            log.audit('SUCCESS', { invoice: invId, placeholderLines: valid.length });

        } catch (e) {
            log.error('INVOICE EDGE BAND ERROR', { invoice: context.newRecord.id, message: e.message });
        }
    };

    return { afterSubmit };
});
