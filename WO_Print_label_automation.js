/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/render', 'N/log'],
function(record, search, render, log) {

    var FOLDER_ID = 38805412;

    // Replace with the actual Sales Order eTail Order ID field ID
    var ETAIL_FIELD = 'custbody_celigo_etail_order_id';

    function escapeXml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function getSalesOrder(soId) {

        var result = search.create({
            type: search.Type.SALES_ORDER,
            filters: [
                ['internalid', 'anyof', soId],
                'AND',
                ['mainline', 'is', 'T']
            ],
            columns: [
                'tranid',
                ETAIL_FIELD
            ]
        }).run().getRange({
            start: 0,
            end: 1
        });

        if (!result.length) {
            return null;
        }

        return {
            number: result[0].getValue('tranid'),
            etailId: result[0].getValue(ETAIL_FIELD)
        };
    }

    function getWorkOrderItems(wo) {

        var items = [];

        // Work Order header assembly
        var assembly = wo.getText({
            fieldId: 'assemblyitem'
        }) || '';

        var quantity = wo.getValue({
            fieldId: 'quantity'
        }) || 0;

        // Work Order component lines
        var count = wo.getLineCount({
            sublistId: 'item'
        });

        for (var i = 0; i < count; i++) {

            var item = wo.getSublistText({
                sublistId: 'item',
                fieldId: 'item',
                line: i
            }) || '';

            var qty = wo.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: i
            }) || 0;

            if (item) {
                items.push({
                    item: item,
                    quantity: qty
                });
            }
        }

        return {
            assembly: assembly,
            quantity: quantity,
            components: items
        };
    }

    function createLabel(woNumber, so, data) {

        var components = data.components;
        var pageSize = 12;
        var pageCount = Math.max(
            1,
            Math.ceil(components.length / pageSize)
        );

        var xml =
            '<?xml version="1.0"?>' +
            '<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">' +
            '<pdf>' +
            '<head>' +
            '<style type="text/css">' +
            'body { font-family: Helvetica; font-size: 9pt; }' +
            'h1 { font-size: 17pt; }' +
            'td { padding: 4px; }' +
            '</style>' +
            '</head>' +
            '<body size="4in 6in" padding="0.2in">';

        for (var p = 0; p < pageCount; p++) {

            if (p > 0) {
                xml += '<pbr/>';
            }

            xml +=
                '<h1>WORK ORDER LABEL</h1>' +
                '<hr/>' +
                '<p><b>Work Order:</b> ' +
                escapeXml(woNumber) + '</p>' +
                '<p><b>Sales Order:</b> ' +
                escapeXml(so.number) + '</p>' +
                '<p><b>eTail Order ID:</b> ' +
                escapeXml(so.etailId) + '</p>' +
                '<p><b>Assembly Item:</b> ' +
                escapeXml(data.assembly) + '</p>' +
                '<p><b>Assembly Quantity:</b> ' +
                escapeXml(data.quantity) + '</p>' +
                '<hr/>' +
                '<p><b>COMPONENT ITEMS</b></p>' +
                '<table width="100%" border="0.5" ' +
                'cellpadding="3">' +
                '<tr>' +
                '<td width="75%"><b>Item</b></td>' +
                '<td width="25%"><b>Qty</b></td>' +
                '</tr>';

            var start = p * pageSize;
            var end = Math.min(
                start + pageSize,
                components.length
            );

            for (var j = start; j < end; j++) {

                xml +=
                    '<tr>' +
                    '<td>' +
                    escapeXml(components[j].item) +
                    '</td>' +
                    '<td>' +
                    escapeXml(components[j].quantity) +
                    '</td>' +
                    '</tr>';
            }

            if (!components.length) {
                xml +=
                    '<tr><td colspan="2">' +
                    'No component lines found' +
                    '</td></tr>';
            }

            xml +=
                '</table>' +
                '<p>&#160;</p>' +
                '<barcode codetype="code128" ' +
                'showtext="true" ' +
                'value="' + escapeXml(woNumber) + '" ' +
                'bar-width="1" bar-height="35"/>' +
                '<p>Page ' + (p + 1) +
                ' of ' + pageCount + '</p>';
        }

        xml += '</body></pdf>';

        var pdf = render.xmlToPdf({
            xmlString: xml
        });

        pdf.name = 'WO_Label_' +
            woNumber.replace(/[^a-zA-Z0-9_-]/g, '_') +
            '.pdf';

        pdf.folder = FOLDER_ID;

        return pdf.save();
    }

    function afterSubmit(context) {

        if (context.type !== context.UserEventType.EDIT) {
            return;
        }

        try {

            var woId = context.newRecord.id;

            var wo = record.load({
                type: record.Type.WORK_ORDER,
                id: woId,
                isDynamic: false
            });

            var woNumber = wo.getValue({
                fieldId: 'tranid'
            });

            var soId = wo.getValue({
                fieldId: 'createdfrom'
            });

            log.debug('Work Order Details', {
                woId: woId,
                woNumber: woNumber,
                createdFrom: soId
            });

            // Only Work Orders created from Sales Orders
            if (!soId) {
                log.audit('Skipped', 'No Created From Sales Order');
                return;
            }

            // Check Sales Order eTail Order ID
            var so = getSalesOrder(soId);

            if (!so || !String(so.etailId || '').trim()) {
                log.audit('Skipped', 'Sales Order eTail ID is empty');
                return;
            }

            // Collect assembly and all components
            var data = getWorkOrderItems(wo);

            log.debug('Label Data', {
                assembly: data.assembly,
                quantity: data.quantity,
                components: data.components.length
            });

            // Prevent duplicate test labels
            var fileName = 'WO_Label_' +
                String(woNumber).replace(
                    /[^a-zA-Z0-9_-]/g, '_'
                ) + '.pdf';

            var existing = search.create({
                type: 'file',
                filters: [
                    ['name', 'is', fileName],
                    'AND',
                    ['folder', 'anyof', FOLDER_ID]
                ],
                columns: ['internalid']
            }).run().getRange({
                start: 0,
                end: 1
            });

            if (existing.length) {
                log.audit('Skipped', 'Label already exists: ' + fileName);
                return;
            }

            // Generate PDF label (no printer API called)
            var fileId = createLabel(woNumber, so, data);

            log.audit('WO Label Created', {
                workOrder: woId,
                salesOrder: soId,
                fileId: fileId,
                folderId: FOLDER_ID,
                components: data.components.length
            });

        } catch (e) {
            log.error({
                title: 'WO Label Creation Failed',
                details: {
                    message: e.message,
                    stack: e.stack
                }
            });
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
