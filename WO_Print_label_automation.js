/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * TEST ONLY: renders the CNC BOM label for a new Work Order
 * and saves the PDF to the File Cabinet. No printer API call.
 */
define(['N/record', 'N/render', 'N/log'],
function (record, render, log) {

    var FOLDER_ID = 38805412;
    var ETAIL_FIELD = 'custbody_celigo_etail_order_id';

    function afterSubmit(context) {

        if (context.type !== context.UserEventType.EDIT) return;

        var woId = context.newRecord.id;

        try {
            // 1. Same "when to print" rules as the old script
            var soId = context.newRecord.getValue('createdfrom');
            if (!soId) {
                log.debug('Skipped', 'WO ' + woId + ' has no Created From');
                return;
            }

            var so = record.load({
                type: record.Type.SALES_ORDER,
                id: soId
            });

            var etailId = so.getValue(ETAIL_FIELD);
            if (!etailId || !String(etailId).trim()) {
                log.debug('Skipped', 'WO ' + woId + ' SO has no eTail ID');
                return;
            }

            // 2. Render the label exactly like the Print BOM button
            var pdf = render.bom({
                entityId: Number(woId),
                printMode: render.PrintMode.PDF
            });

            // 3. Save to the File Cabinet
            pdf.name = 'WO_Label_' + woId + '.pdf';
            pdf.folder = FOLDER_ID;
            var fileId = pdf.save();

            log.audit('WO Label PDF Saved', {
                woId: woId,
                soId: soId,
                fileId: fileId
            });

        } catch (e) {
            log.error('WO Label Test Failed', {
                woId: woId,
                message: e.message,
                stack: e.stack
            });
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});