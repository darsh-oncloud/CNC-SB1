
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define([
    'N/ui/serverWidget',
    'N/record',
    'N/render',
    'N/log'
], function(ui, record, render, log) {

    function escapeXml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function getWorkOrder(woId) {

        var wo = record.load({
            type: record.Type.WORK_ORDER,
            id: Number(woId),
            isDynamic: false
        });

        return {
            wonumber: String(wo.getValue({
                fieldId: 'tranid'
            }) || ''),

            item: String(wo.getText({
                fieldId: 'assemblyitem'
            }) || ''),

            quantity: String(wo.getValue({
                fieldId: 'quantity'
            }) || '')
        };
    }

    function generatePreview(data) {

        var woNumber = escapeXml(data.wonumber);
        var item = escapeXml(data.item);
        var quantity = escapeXml(data.quantity);

        var xml = '<?xml version="1.0"?>' +
            '<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">' +
            '<pdf>' +
            '<head>' +
            '<style type="text/css">' +
            'body { font-family: Helvetica, sans-serif; font-size: 12pt; }' +
            '.heading { font-size: 21pt; font-weight: bold; }' +
            '.fieldlabel { font-size: 12pt; font-weight: bold; }' +
            '.fieldvalue { font-size: 18pt; font-weight: bold; }' +
            '</style>' +
            '</head>' +

            '<body size="4in 6in" padding="0.25in">' +

            '<p class="heading">WORK ORDER</p>' +
            '<hr/>' +

            '<p class="fieldlabel">WO Number:</p>' +
            '<p class="fieldvalue">' + woNumber + '</p>' +

            '<p class="fieldlabel">Assembly Item:</p>' +
            '<p class="fieldvalue">' + item + '</p>' +

            '<p class="fieldlabel">Quantity:</p>' +
            '<p class="fieldvalue">' + quantity + '</p>' +

            '<p>&#160;</p>' +

            '<barcode codetype="code128" ' +
            'showtext="true" ' +
            'value="' + woNumber + '" ' +
            'bar-width="1.5" ' +
            'bar-height="65"/>' +

            '</body></pdf>';

        return render.xmlToPdf({
            xmlString: xml
        });
    }

    function onRequest(context) {

        var params = context.request.parameters || {};
        var woId = params.custpage_wo_id || '';
        var errorMessage = '';

        if (context.request.method === 'POST') {

            try {

                if (!/^[1-9]\d*$/.test(String(woId))) {
                    throw new Error(
                        'Enter a valid Work Order Internal ID.'
                    );
                }

                var data = getWorkOrder(woId);

                if (!data.wonumber || !data.item) {
                    throw new Error(
                        'Work Order number or Assembly Item is missing.'
                    );
                }

                log.audit({
                    title: 'WO Label Preview',
                    details: {
                        woId: woId,
                        data: data
                    }
                });

                var pdf = generatePreview(data);

                pdf.name = 'WO_Label_' +
                    data.wonumber + '.pdf';

                context.response.writeFile({
                    file: pdf,
                    isInline: true
                });

                return;

            } catch (e) {

                errorMessage = e.message;

                log.error({
                    title: 'WO Label Preview Error',
                    details: e
                });
            }
        }

        var form = ui.createForm({
            title: 'Work Order Label - Test'
        });

        var info = form.addField({
            id: 'custpage_info',
            type: ui.FieldType.INLINEHTML,
            label: 'Information'
        });

        info.defaultValue =
            '<div style="padding:12px;">' +
            '<b>Work Order Label Preview</b><br>' +
            'Enter a Work Order Internal ID to view ' +
            'the label using actual NetSuite data.' +
            '<br>No physical printing will occur.' +
            '</div>';

        var field = form.addField({
            id: 'custpage_wo_id',
            type: ui.FieldType.INTEGER,
            label: 'Work Order Internal ID'
        });

        field.isMandatory = true;
        field.defaultValue = String(woId);

        if (errorMessage) {

            var errorField = form.addField({
                id: 'custpage_error',
                type: ui.FieldType.INLINEHTML,
                label: 'Error'
            });

            errorField.defaultValue =
                '<div style="color:red;padding:10px;">' +
                escapeXml(errorMessage) +
                '</div>';
        }

        form.addSubmitButton({
            label: 'Preview Label'
        });

        context.response.writePage(form);
    }

    return {
        onRequest: onRequest
    };
});
