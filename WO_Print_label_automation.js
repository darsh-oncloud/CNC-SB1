/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/render', 'N/https', 'N/log'],
function (record, render, https, log) {

    var PRINTER_ID = 103;
    var FOLDER_ID = 38805412;

    function afterSubmit(context) {
        if (context.type !== context.UserEventType.CREATE) return;

        try {
            var woId = context.newRecord.id;

            // 1. Should this WO print?
            var soId = context.newRecord.getValue('createdfrom');
            if (!soId) return;

            var so = record.load({ type: record.Type.SALES_ORDER, id: soId });
            var etailId = so.getValue('custbody_celigo_etail_order_id');
            if (!etailId || !String(etailId).trim()) return;

            // 2. Render your CNC BOM template
            var pdf = render.bom({
                entityId: Number(woId),
                printMode: render.PrintMode.PDF
            });

            // 3. Save a copy
            pdf.name = 'WO_Label_' + woId + '.pdf';
            pdf.folder = FOLDER_ID;
            var fileId = pdf.save();

            // 4. Send to printer (fill in per RF-SMART docs)
            var response = https.requestRestlet({
                scriptId: 'customscript_sit_lpc_rest_api',
                deploymentId: 'customdeploy_sit_lpc_rest_api',
                method: https.Method.POST,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api: 'printLabels',
                    options: {
                        source: 'WO_' + woId,
                        printer: PRINTER_ID,
                        async: false
                        // + the PDF/file field from RF-SMART docs
                    }
                })
            });

            var result = JSON.parse(response.body);
            if (result.success !== true) {
                throw new Error(result.message || 'Print failed');
            }

            log.audit('WO Label Printed', { woId: woId, fileId: fileId });

        } catch (e) {
            log.error('WO Label Failed', { woId: context.newRecord.id, message: e.message });
        }
    }

    return { afterSubmit: afterSubmit };
});