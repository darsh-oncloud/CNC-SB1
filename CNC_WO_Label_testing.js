/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/ui/serverWidget', 'N/record', 'N/https', 'N/log'],
function(ui, record, https, log) {

    var TEMPLATE_ID = 1895;
    var PRINTER_ID = 103;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function onRequest(context) {

        var params = context.request.parameters;
        var woId = params.custpage_wo_id || '';
        var message = '';
        var generated = '';
        var details = null;
        var failed = false;

        if (context.request.method === 'POST') {

            try {

                if (!/^[1-9]\d*$/.test(String(woId))) {
                    throw new Error(
                        'Enter a valid Work Order internal ID.'
                    );
                }

                // Load Work Order
                var wo = record.load({
                    type: record.Type.WORK_ORDER,
                    id: Number(woId),
                    isDynamic: false
                });

                var woNumber = wo.getValue({
                    fieldId: 'tranid'
                });

                var assemblyItem = wo.getText({
                    fieldId: 'assemblyitem'
                }) || '';

                var quantity = wo.getValue({
                    fieldId: 'quantity'
                });

                details = {
                    internalId: woId,
                    wonumber: String(woNumber || ''),
                    item: String(assemblyItem || ''),
                    quantity: String(quantity == null ? '' : quantity)
                };

                if (!details.wonumber || !details.item) {
                    throw new Error(
                        'Work Order number or assembly item is missing.'
                    );
                }

                // Match SIT LPC Label Design fields
                var dataSet = [{
                    wonumber: details.wonumber,
                    item: details.item,
                    quantity: details.quantity
                }];

                var options = {
                    source: 'WO_LABEL_TEST_' + woId,
                    templateId: TEMPLATE_ID,
                    printer: PRINTER_ID,
                    async: false,
                    processType: 'GENERATE_AND_RETURN',
                    dataSet: dataSet
                };

                log.audit({
                    title: 'WO Label Test Request',
                    details: JSON.stringify(options)
                });

                // Call SIT LPC REST API
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

                var result;

                try {
                    result = JSON.parse(response.body);
                } catch (parseError) {
                    throw new Error(
                        'Invalid API response. HTTP ' + response.code
                    );
                }

                log.audit({
                    title: 'WO Label Test Response',
                    details: JSON.stringify({
                        http: response.code,
                        success: result.success,
                        message: result.message,
                        code: result.code
                    })
                });

                if (Number(response.code) < 200 ||
                    Number(response.code) >= 300 ||
                    result.success !== true) {

                    throw new Error(
                        result.message ||
                        result.code ||
                        'Label generation failed.'
                    );
                }

                var payload = result.payload || {};

                if (payload.file) {
                    generated = String(
                        payload.file.content || ''
                    ).slice(0, 100000);
                }

                message =
                    'Label generation successful.\n' +
                    'No physical print requested.\n' +
                    'API Record: ' +
                    (payload.apiRecId || 'Not returned') + '\n' +
                    'Print Log: ' +
                    (payload.logId || 'Not returned');

            } catch (e) {

                failed = true;
                message = e.message;

                log.error({
                    title: 'WO Label Test Failed',
                    details: {
                        woId: woId,
                        message: e.message,
                        stack: e.stack
                    }
                });
            }
        }

        // Suitelet Form
        var form = ui.createForm({
            title: 'Work Order Label - Test'
        });

        var intro = form.addField({
            id: 'custpage_intro',
            type: ui.FieldType.INLINEHTML,
            label: 'Instructions'
        });

        intro.defaultValue =
            '<div style="padding:10px;">' +
            '<b>Template:</b> ' + TEMPLATE_ID + '<br>' +
            '<b>Printer:</b> ' + PRINTER_ID + '<br>' +
            '<b>Mode:</b> Generate Only - No Physical Print' +
            '</div>';

        var woField = form.addField({
            id: 'custpage_wo_id',
            type: ui.FieldType.INTEGER,
            label: 'Work Order Internal ID'
        });

        woField.isMandatory = true;
        woField.defaultValue = String(woId);

        if (details) {

            var info = form.addField({
                id: 'custpage_details',
                type: ui.FieldType.INLINEHTML,
                label: 'Work Order Details'
            });

            info.defaultValue =
                '<div style="padding:10px;">' +
                '<h3>Work Order Details</h3>' +
                '<b>WO Number:</b> ' +
                escapeHtml(details.wonumber) + '<br>' +
                '<b>Assembly Item:</b> ' +
                escapeHtml(details.item) + '<br>' +
                '<b>Quantity:</b> ' +
                escapeHtml(details.quantity) +
                '</div>';
        }

        if (message) {

            var resultField = form.addField({
                id: 'custpage_result',
                type: ui.FieldType.INLINEHTML,
                label: 'Result'
            });

            resultField.defaultValue =
                '<pre style="padding:12px;white-space:pre-wrap;' +
                'color:' + (failed ? '#b91c1c' : '#166534') +
                ';">' + escapeHtml(message) + '</pre>';
        }

        if (generated) {

            var output = form.addField({
                id: 'custpage_output',
                type: ui.FieldType.LONGTEXT,
                label: 'Generated Label Output - ZPL'
            });

            output.defaultValue = generated;

            output.updateDisplayType({
                displayType: ui.FieldDisplayType.READONLY
            });
        }

        form.addSubmitButton({
            label: 'Generate Label - Test Only'
        });

        context.response.writePage(form);
    }

    return {
        onRequest: onRequest
    };
});
