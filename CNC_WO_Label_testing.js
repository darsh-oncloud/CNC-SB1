
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * Authenticated, internal RF-SMART Work Order label test tool.
 * Deploy inside the target account.
 */
define(['N/ui/serverWidget', 'N/https', 'N/log', 'N/runtime', 'N/record'],
function(ui, https, log, runtime, record) {

    function id(value, label) {
        if (!/^[1-9]\d*$/.test(String(value || ''))) {
            throw new Error(label + ' must be a positive internal ID.');
        }
        return Number(value);
    }

    function loadWorkOrder(woId) {

        var rec = record.load({
            type: record.Type.WORK_ORDER,
            id: id(woId, 'Work Order'),
            isDynamic: false
        });

        var woNumber = String(
            rec.getValue({ fieldId: 'tranid' }) || ''
        );

        var item = String(
            rec.getText({ fieldId: 'assemblyitem' }) || ''
        );

        var quantity = Number(
            rec.getValue({ fieldId: 'quantity' })
        );

        if (!woNumber) {
            throw new Error('Work Order number is missing.');
        }

        if (!item) {
            throw new Error('Work Order assembly item is missing.');
        }

        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('Work Order quantity must be positive.');
        }

        return {
            wonumber: woNumber,
            item: item,
            quantity: String(quantity)
        };
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function(c) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[c];
        });
    }

    function flatten(input) {

        if (!Array.isArray(input) ||
            !input.length ||
            input.length > 20) {
            throw new Error('Supply an array of 1-20 Work Orders.');
        }

        var pages = [];

        function text(value, name, max) {
            var s = String(
                value == null ? '' : value
            ).trim();

            if (s.length > max ||
                /[\r\n\x00-\x1f]/.test(s)) {
                throw new Error('Invalid or oversized ' + name + '.');
            }

            return s;
        }

        for (var i = 0; i < input.length; i++) {

            var wo = input[i];

            if (!wo || typeof wo !== 'object') {
                throw new Error('Invalid Work Order object.');
            }

            var woNumber = text(
                wo.wonumber, 'Work Order number', 32
            );

            var item = text(
                wo.item, 'Assembly Item', 100
            );

            var quantity = Number(wo.quantity);

            var copies = Number(
                wo.printqty == null ? 1 : wo.printqty
            );

            if (!woNumber || !item) {
                throw new Error(
                    'Work Order number and item are required.'
                );
            }

            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new Error(
                    'Work Order quantity must be positive.'
                );
            }

            if (!Number.isInteger(copies) ||
                copies < 1 || copies > 20) {
                throw new Error('Copies must be 1-20.');
            }

            pages.push({
                wonumber: woNumber,
                item: item,
                quantity: String(quantity),
                printqty: String(copies)
            });
        }

        var totalCopies = 0;

        for (var j = 0; j < pages.length; j++) {
            totalCopies += Number(pages[j].printqty);
        }

        if (totalCopies > 100) {
            throw new Error(
                'Limit each request to 100 physical labels including copies.'
            );
        }

        return pages;
    }

    function onRequest(context) {

        var p = context.request.parameters;

        var message = '';
        var generated = '';
        var failed = false;
        var wo = null;

        var woId = p.custpage_wo || p.woId || '';

        if (woId) {
            try {
                wo = loadWorkOrder(woId);
            } catch (e) {
                failed = true;
                message = e.message;

                log.error({
                    title: 'WO_LOAD_FAILED',
                    details: e
                });
            }
        }

        var trace = 'RFTEST-' +
            Date.now().toString(36) + '-' +
            Math.random().toString(36).slice(2, 8);

        if (context.request.method === 'POST') {

            var attempted = false;

            try {

                // Target account configuration
                var templateId = 2;
                var printer = 103;

                if (p.custpage_mode !== 'test' &&
                    p.custpage_mode !== 'print') {
                    throw new Error('Select an operation.');
                }

                if (p.custpage_mode === 'print' &&
                    p.custpage_confirm !== 'T') {
                    throw new Error(
                        'Confirm physical printing before submitting.'
                    );
                }

                if (!wo) {
                    throw new Error(
                        message || 'Provide a valid Work Order ID.'
                    );
                }

                var dataSet = flatten([{
                    wonumber: wo.wonumber,
                    item: wo.item,
                    quantity: wo.quantity,
                    printqty: p.custpage_copies || '1'
                }]);

                var options = {
                    source: trace,
                    templateId: templateId,
                    printer: printer,
                    async: false,
                    processType:
                        p.custpage_mode === 'print'
                        ? 'GENERATE_BEFORE_SEND'
                        : 'GENERATE_AND_RETURN',
                    dataSet: dataSet
                };

                log.audit({
                    title: trace + ' REQUEST',
                    details: JSON.stringify({
                        account: runtime.accountId,
                        user: runtime.getCurrentUser().id,
                        woId: woId,
                        templateId: templateId,
                        printer: printer,
                        processType: options.processType,
                        pages: dataSet.length
                    })
                });

                log.debug({
                    title: trace + ' DATASET',
                    details: JSON.stringify(dataSet).slice(0, 3900)
                });

                attempted = true;

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
                } catch (e) {
                    throw new Error(
                        'Non-JSON RF-SMART response; HTTP ' +
                        response.code
                    );
                }

                var payload = result.payload || {};

                log.audit({
                    title: trace + ' RESPONSE',
                    details: JSON.stringify({
                        http: response.code,
                        success: result.success,
                        message: result.message,
                        code: result.code,
                        apiRecId: payload.apiRecId,
                        logId: payload.logId
                    }).slice(0, 3900)
                });

                if (Number(response.code) < 200 ||
                    Number(response.code) >= 300 ||
                    result.success !== true) {

                    throw new Error(
                        String(
                            result.message ||
                            result.code ||
                            'RF-SMART request failed.'
                        )
                    );
                }

                message =
                    (p.custpage_mode === 'print'
                        ? 'RF-SMART accepted the request. Physical delivery is not confirmed.'
                        : 'Generation succeeded. Nothing sent to the printer.') +
                    '\nTrace: ' + trace +
                    '\nAPI record: ' +
                    (payload.apiRecId || 'not returned') +
                    '\nPrint log: ' +
                    (payload.logId || 'not returned');

                if (p.custpage_mode === 'test' && payload.file) {
                    generated = String(
                        payload.file.content || ''
                    ).slice(0, 100000);
                }

            } catch (error) {

                failed = true;

                message = error.message +
                    '\nTrace: ' + trace;

                if (attempted &&
                    p.custpage_mode === 'print') {

                    message +=
                        '\nSubmission may have occurred. Check RF-SMART logs before retrying.';
                }

                log.error({
                    title: trace + ' FAILED',
                    details: JSON.stringify({
                        message: error.message,
                        stack: error.stack,
                        attempted: attempted
                    }).slice(0, 3900)
                });
            }
        }

        var form = ui.createForm({
            title: 'Work Order Label Print Test'
        });

        var notice = form.addField({
            id: 'custpage_notice',
            type: ui.FieldType.INLINEHTML,
            label: 'Instructions'
        });

        notice.defaultValue =
            '<p>Account: <b>' +
            escapeHtml(runtime.accountId) +
            '</b>. Template 2; printer 103 (CNC-NV-SLAND_1).' +
            ' Work Order number, assembly item and quantity.' +
            ' Test generation first.</p>' +
            (message
                ? '<pre style="white-space:pre-wrap;color:' +
                  (failed ? '#b91c1c' : '#166534') +
                  '">' + escapeHtml(message) +
                  '</pre><p>Do not refresh this submitted page; refreshing can resubmit the request.</p>'
                : '');

        function field(key, label, type, value, mandatory) {

            var f = form.addField({
                id: key,
                label: label,
                type: type
            });

            f.defaultValue = value || '';
            f.isMandatory = !!mandatory;

            return f;
        }

        field(
            'custpage_wo',
            'Work Order Internal ID',
            ui.FieldType.INTEGER,
            woId,
            true
        );

        field(
            'custpage_copies',
            'Copies (1-20)',
            ui.FieldType.INTEGER,
            p.custpage_copies || '1',
            true
        );

        var mode = field(
            'custpage_mode',
            'Operation',
            ui.FieldType.SELECT
        );

        mode.addSelectOption({
            value: 'test',
            text: 'Test generation - no physical print',
            isSelected: p.custpage_mode !== 'print'
        });

        mode.addSelectOption({
            value: 'print',
            text: 'Send to physical printer',
            isSelected: p.custpage_mode === 'print'
        });

        field(
            'custpage_confirm',
            'I intend to send this label to the selected physical printer',
            ui.FieldType.CHECKBOX,
            'F'
        );

        if (wo) {

            field(
                'custpage_review',
                'Work Order Details',
                ui.FieldType.INLINEHTML
            ).defaultValue =
                '<h3>' + escapeHtml(wo.wonumber) + '</h3>' +
                '<table border="1" cellpadding="6">' +
                '<tr><th>Work Order</th><th>Assembly Item</th><th>Quantity</th></tr>' +
                '<tr><td>' + escapeHtml(wo.wonumber) +
                '</td><td>' + escapeHtml(wo.item) +
                '</td><td>' + escapeHtml(wo.quantity) +
                '</td></tr></table>';
        }

        if (generated) {

            field(
                'custpage_generated',
                'Generated Output (first 100,000 characters)',
                ui.FieldType.LONGTEXT,
                generated
            ).updateDisplayType({
                displayType: ui.FieldDisplayType.READONLY
            });
        }

        form.addSubmitButton({
            label: 'Run Selected Operation'
        });

        context.response.writePage(form);
    }

    return {
        onRequest: onRequest
    };
});
