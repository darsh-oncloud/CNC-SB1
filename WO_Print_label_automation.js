/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/render', 'N/https', 'N/log'],
function(record, render, https, log) {

    var TEMPLATE_ID = 1;
    var PRINTER_ID = 103;
    var FOLDER_ID = 38805412;
    var ETAIL_FIELD = 'custbody_celigo_etail_order_id';

    function xml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function afterSubmit(context) {

        if (context.type !== context.UserEventType.CREATE) return;

        try {
            var woId = context.newRecord.id;

            var wo = record.load({
                type: record.Type.WORK_ORDER,
                id: woId
            });

            var soId = wo.getValue('createdfrom');
            if (!soId) return;

            var so = record.load({
                type: record.Type.SALES_ORDER,
                id: soId
            });

            var etailId = so.getValue(ETAIL_FIELD);
            if (!etailId || !String(etailId).trim()) return;

            var woNumber = String(wo.getValue('tranid') || '');
            var soNumber = String(so.getValue('tranid') || '');
            var assembly = wo.getText('assemblyitem') || '';
            var quantity = wo.getValue('quantity') || 0;

            var items = [];
            var count = wo.getLineCount({ sublistId: 'item' });

            for (var i = 0; i < count; i++) {

                var item = wo.getSublistText({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: i
                });

                var qty = wo.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: i
                });

                if (item) {
                    items.push({
                        item: String(item),
                        quantity: String(qty || 0)
                    });
                }
            }

            // Save visual PDF label to File Cabinet
            var pages = Math.max(1, Math.ceil(items.length / 12));

            var pdfXml =
                '<?xml version="1.0"?>' +
                '<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">' +
                '<pdf><head><style>' +
                'body{font-family:Helvetica;font-size:9pt;}' +
                'h1{font-size:17pt;}' +
                'td{padding:4px;}' +
                '</style></head>' +
                '<body size="4in 6in" padding="0.2in">';

            for (var p = 0; p < pages; p++) {

                if (p > 0) pdfXml += '<pbr/>';

                pdfXml +=
                    '<h1>WORK ORDER LABEL</h1><hr/>' +
                    '<p><b>Work Order:</b> ' + xml(woNumber) + '</p>' +
                    '<p><b>Sales Order:</b> ' + xml(soNumber) + '</p>' +
                    '<p><b>eTail Order ID:</b> ' + xml(etailId) + '</p>' +
                    '<p><b>Assembly Item:</b> ' + xml(assembly) + '</p>' +
                    '<p><b>Assembly Quantity:</b> ' + xml(quantity) + '</p>' +
                    '<hr/><p><b>COMPONENT ITEMS</b></p>' +
                    '<table width="100%" border="0.5" cellpadding="3">' +
                    '<tr><td width="75%"><b>Item</b></td>' +
                    '<td width="25%"><b>Qty</b></td></tr>';

                for (var j = p * 12;
                     j < Math.min((p + 1) * 12, items.length);
                     j++) {

                    pdfXml +=
                        '<tr><td>' + xml(items[j].item) +
                        '</td><td>' + xml(items[j].quantity) +
                        '</td></tr>';
                }

                pdfXml +=
                    '</table><p>&#160;</p>' +
                    '<barcode codetype="code128" showtext="true" ' +
                    'value="' + xml(woNumber) + '" ' +
                    'bar-width="1" bar-height="35"/>' +
                    '<p>Page ' + (p + 1) + ' of ' + pages + '</p>';
            }

            pdfXml += '</body></pdf>';

            var pdf = render.xmlToPdf({
                xmlString: pdfXml
            });

            pdf.name = 'WO_Label_' + woId + '.pdf';
            pdf.folder = FOLDER_ID;

            var fileId = pdf.save();

            log.audit('WO Label PDF Saved', {
                woId: woId,
                fileId: fileId,
                components: items.length
            });

            // RF-SMART API printing
            var dataSet = [{
                wonumber: woNumber,
                sonumber: soNumber,
                etailid: String(etailId),
                item: String(assembly),
                quantity: String(quantity),
                components: items,
                printqty: '1'
            }];

            var options = {
                source: 'WO_' + woId,
                templateId: TEMPLATE_ID,
                printer: PRINTER_ID,
                async: false,
                processType: 'GENERATE_BEFORE_SEND',
                dataSet: dataSet
            };

            var response = https.requestRestlet({
                scriptId: 'customscript_sit_lpc_rest_api',
                deploymentId: 'customdeploy_sit_lpc_rest_api',
                method: https.Method.POST,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    api: 'printLabels',
                    options: options
                })
            });

            var result = JSON.parse(response.body);

            if (Number(response.code) < 200 ||
                Number(response.code) >= 300 ||
                result.success !== true) {

                throw new Error(
                    result.message || result.code ||
                    'SIT LPC printing failed'
                );
            }

            log.audit('WO Label Print Submitted', {
                woId: woId,
                soId: soId,
                templateId: TEMPLATE_ID,
                printerId: PRINTER_ID,
                fileId: fileId,
                apiRecord: result.payload &&
                    result.payload.apiRecId,
                printLog: result.payload &&
                    result.payload.logId
            });

        } catch (e) {
            log.error('WO Label AfterSubmit Failed', {
                woId: context.newRecord.id,
                message: e.message,
                stack: e.stack
            });
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
