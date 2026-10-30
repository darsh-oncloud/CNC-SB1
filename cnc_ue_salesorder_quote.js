define(["require", "exports", "N/search", "N/task", "N/log", "N/runtime", "N/email", "N/record", "N/query", "../../../cnc_functions.js", "N/ui/serverWidget", "../../../cnc_functions.js", "../../../CNC/ramda.js"], function (require, exports, search, task, log, runtime, email, record, query, cnc_functions_js_1, serverWidget, cnc_functions, R) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.beforeLoad = beforeLoad;
    exports.beforeSubmit = beforeSubmit;
    exports.afterSubmit = afterSubmit;
    /**
     * @Description Sales Order user event script.
     * @NApiVersion 2.1
     * @NScriptType UserEventScript
     */
    function FDATAUESOAssignTruckBeforeLoad(context) {
        // Since the purpose of this beforeLoad function is to display a banner notifying a shipmethod swap, it would'nt accomplish anything if it ran outside in the UI.
        if (runtime.executionContext != runtime.ContextType.USER_INTERFACE) {
            return;
        }
        if (context.type !== context.UserEventType.VIEW && context.type !== context.UserEventType.EDIT)
            return;
        var rec = context.newRecord;
        var message = rec.getValue('custbody_fd_ata_notification');
        if (!message)
            return;
        var bannerField = context.form.addField({
            id: 'custpage_fd_ata_banner_message',
            label: 'Status message',
            type: serverWidget.FieldType.INLINEHTML
        });
        bannerField.defaultValue = "<script type=\"text/javascript\">require(['N/ui/message'], function(message) {var statusMessage = message.create({title: \"Ship method changed\", message: `" + message + "`, type: message.Type.WARNING});statusMessage.show();});</script>";
        try {
            // To save more time and avoid this submitFields call altogether, we should consider adding an (undisplayed) expiration date to the message so that it only displays withing the first couple of minutes after it's set, without the need of clearing it, (or the extra system notes mess). This script does not run often however, and the difference would not be that significant - YNK 11/4/2025
            const type = String(rec.getValue('baserecordtype'));
            if (!rec.id)
                return; // TS appease as the function already does not run on create 
            record.submitFields({
                type,
                id: rec.id,
                values: {
                    custbody_fd_ata_notification: ''
                }
            });
        }
        catch (e) {
            //@ts-ignore
            log.error('FDATAUESOAssignTruckBeforeLoad', e.message);
        }
    }
    function AHDeleteSOBeforeLoad(context) {
        try {
            if (context.type != context.UserEventType.EDIT) {
                return;
            }
            const form = context.form;
            const delButton = form.addButton({ id: 'custpage_ah_deleteorder_button', label: 'Delete Sales Order', functionName: 'deleteSo' });
        }
        catch (e) {
            log.error('@AHDeleteSOBeforeLoad: error loading so', e.message);
        }
    }
    function FDACWUECheckWOCheckboxBeforeLoad(context) {
        try {
            var { form, newRecord, type, UserEventType } = context;
            if (runtime.executionContext != runtime.ContextType.USER_INTERFACE) {
                return;
            }
            if ([94242, 192348, 118245, 3568].includes(Number(runtime.getCurrentUser().id))) {
                form.addButton({
                    id: 'custpage_ccm_convert_credit_memo',
                    label: 'Apply Credit',
                    functionName: 'onConvertCreditMemo'
                });
            }
            if (![UserEventType.CREATE, UserEventType.EDIT, UserEventType.COPY, UserEventType.TRANSFORM].includes(type))
                return;
            var status = String(newRecord.getValue('orderstatus'));
            if (status !== 'A')
                return;
            var itemSublist = form.getSublist({ id: 'item' });
            itemSublist.addButton({
                id: 'custpage_caw_check_all_btn',
                label: 'Check All Workorders',
                functionName: 'onCheckAllWorkorders'
            });
        }
        catch (e) {
            //@ts-ignore
            log.error('@FDACWUECheckWOCheckboxBeforeLoad', e.message);
        }
    }
    function getAllResults(resultSet) {
        // Loop while we don't have all the results
        function loop(resultSet, arr, start) {
            var range = resultSet.getRange({
                start: start,
                end: start + 1000
            });
            // If we don't have all the results loop again
            if (range != null && range.length == 1000)
                return loop(resultSet, arr.concat(range), start + 1000);
            else
                // When we have them all return
                return arr.concat(range);
        }
        return loop(resultSet, [], 0);
    } // Support function for NKUESetTransactionFieldDefaults
    function NKUEConsolidateSourcedFields(context) {
        try {
            // Section 1: Clear feedback rating and comments so that they remain on the quote
            var { newRecord, type, form, UserEventType } = context;
            if (type == UserEventType.CREATE) {
                newRecord.setValue({ fieldId: 'custbody_nk_feedback_rating', value: '' });
                newRecord.setValue({ fieldId: 'custbody_nk_feedback_comments', value: '' });
            }
            // log.debug('@NKUEConsolidateSourcedFields', Array.from({ length: newRecord.getLineCount('item') }, (_, i) => i).reduce((html, line) => {
            //     var item = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line });
            //     var item_display = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item_display', line });
            //     var itemtype = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line });
            //     return itemtype !== 'Assembly' ? html : html += `<div class="scroll-item" data-item-id=${item}>${item_display}</div>`
            // }, ''))
            form.getField({ id: 'custbody_nk_view_buildable_details' }).defaultValue = `

                <button id="open-buildable-view">View Buildable Details</button>
                <script>
                    (function() {
                    var html = \`
                        <style>
                            #buildable-modal-overlay {
                                display: flex;
                                justify-content: space-around;
                                align-items: center;
                                position: fixed;
                                z-index: 1102;
                                left: 0;
                                top: 0;
                                width: 100%;
                                height: 100%;
                                overflow: auto;
                                background-color: rgb(0,0,0);
                                background-color: rgba(0,0,0,0.4);
                                /* Override x4labs styles */
                                color: black;
                                font-size: 12px;
                                font-family: tahoma, arial, verdana, sans-serif;
                                -webkit-font-smoothing: antialiased;
                            }
                            
                            #buildable-modal {
                                font-family: Arial, sans-serif;
                                width: 25%;
                                height: 40%;
                                border-radius: 10px;
                                background-color: #fff;
                                box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            }
                            
                            #table-side {
                                height: 100%;
                                width: 100%;
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                overflow: auto;
                            }
                            
                            @media (max-width: 1500px) {
                                #buildable-modal {
                                    width: 40%;
                                }
                            }
                            
                            .location-tabs {
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            }
                            
                            #scroll-wheel {
                                display: flex;
                                flex: 35%;
                                flex-direction: column;
                                height: 100%;
                                overflow-x: hidden;
                                overflow-y: scroll;
                                scrollbar-width: thin;
                                scrollbar-color: #888 #ccc;
                            }
                            
                            #scroll-wheel::-webkit-scrollbar {
                                width: 8px;
                            }
                            
                            #scroll-wheel::-webkit-scrollbar-thumb {
                                background-color: #888;
                                border-radius: 10px;
                            }
                            
                            #scroll-wheel::-webkit-scrollbar-track {
                                background-color: #ccc;
                                border-radius: 10px;
                            }
                            
                            .scroll-line {
                                padding: 10px;
                                border-bottom: 1px solid #eee;
                                transition: transform 0.2s, color 0.2s;
                                color: #888;
                            }
                            
                            .scroll-line:last-child {
                                border-bottom: none;
                            }
                            
                            .scroll-line, .scroll-line span {
                                cursor: pointer;
                            }
                            
                            .scroll-line.selected {
                                transform: scale(1.5);
                                color: #000;
                            }

                            #component-table {
                                overflow: hidden;
                                display: flex;
                                flex-direction: column;
                                height: 100%;
                            }
                            
                            .location-tab {
                                width: 20%;
                                padding-top: 20%;
                                box-sizing: border-box;
                                position: relative;
                            }
                            
                            #input-header {
                                width: 100%;
                                padding: 10px;
                                display: flex;
                                justify-content: space-around;
                                align-items: center;
                            }
                            
                            .table-container {
                                width: 100%;
                            }
                            
                            .bom-cell {
                                width: 20%;
                                padding: 1px;
                            }
                            
                            .req-cell { 
                                width: 20%; 
                                padding: 1px; 
                            }
                            
                            .avail-cell { 
                                width: 20%; 
                                padding: 1px; 
                            }
                            
                            .comp-cell { 
                                width: 40%; 
                                padding: 1px; 
                            }
                            
                            #component-table-body tr, #component-table thead tr { 
                                display: flex;
                                width: 100%; 
                            }
                            
                            #component-table-body {
                                height: 100%;
                                display: flex;
                                flex-direction: column;
                                overflow: hidden;
                                overflow-y: auto;
                                scrollbar-width: thin;
                                scrollbar-color: #888 #ccc;
                            }
                            
                            .location-name {
                                cursor: default;
                                position: absolute;
                                top: 0;
                                bottom: 0;
                                left: 0;
                                right: 0;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                background-color: silver;
                                color: white;
                                border: 1px solid #ddd;
                            }
                            
                            #component-table-body tr:nth-child(even) {
                                background-color: #f2f2f2;
                            }
                        </style>
                        <div id="buildable-modal-overlay">
                            <div id="buildable-modal">
                                <div id="scroll-wheel"></div>
                                <div id="table-side">
                                    <div id="input-header">
                                        <input type="text" id="item-input">
                                        <label>
                                            NFP
                                            <input type="checkbox" id="nfp-input" class="nfp-checkbox">
                                        </label>
                                        ${type == context.UserEventType.VIEW ? '<button class="download-csv">csv</button>' : ''}
                                    </div>
                                    <div class="table-container">
                                        <div class="location-tabs">
                                            <div class="location-tab">
                                                <div class="location-name" data-location-id="7">NJ</div>
                                            </div>
                                            <div class="location-tab">
                                                <div class="location-name" data-location-id="10">NV</div>
                                            </div>
                                            <div class="location-tab">
                                                <div class="location-name" data-location-id="11">FL</div>
                                            </div>
                                            <div class="location-tab">
                                                <div class="location-name" data-location-id="12">TX</div>
                                            </div>
                                            <div class="location-tab">
                                                <div class="location-name" data-location-id="16">SC</div>
                                            </div>
                                        </div>
                                        <table id="component-table">
                                            <thead>
                                                <tr>
                                                    <th class="bom-cell">BOM</th>
                                                    <th class="req-cell">Req</th>
                                                    <th class="avail-cell">Available</th>
                                                    <th class="comp-cell">Components</th>
                                                </tr>
                                            </thead>
                                            <tbody id="component-table-body"></tbody>
                                        </table>
                                    </div>
                                    <!--div style="font-size: 0.5rem; margin: 100px 0 0 0;">*Indicates default BOM for purchasing</div-->
                                </div>
                            </div>
                        </div>
                    \`
                    document.getElementById('open-buildable-view').addEventListener('click', e => {
                        e.preventDefault();
                        var body = document.querySelector('body');
                        var div = document.createElement('div');
                        div.id = 'view-buildable-modal';
                        div.innerHTML = html;
                        body.append(div);
                        var itemid = [];
                        var subsidiaryid = ${type == context.UserEventType.VIEW ? newRecord.getValue('subsidiary') : `nlapiGetFieldValue('subsidiary')`};
                        var locationid = ${type == context.UserEventType.VIEW ? newRecord.getValue('location') : `nlapiGetFieldValue('location')`};
                        var nfp = ${type == context.UserEventType.VIEW ? newRecord.getValue('custbody_yy_nfp') : `nlapiGetFieldValue('custbody_yy_nfp')`};
                        var scrollWheel = document.getElementById('scroll-wheel');
                        scrollWheel.innerHTML = ${(context.type == context.UserEventType.VIEW ? `\`${Array.from({ length: newRecord.getLineCount('item') }, (_, i) => i).reduce((html, line) => {
                var item = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line });
                var item_display = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item_display', line });
                var quantity = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line });
                var itemtype = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line });
                return itemtype !== 'Assembly' ? html : html += `<div class="scroll-line" data-item-id=${item}><span class="scroll-item">${item_display}</span><span class="scroll-qty">${quantity || 0 > 1 ? ' (' + quantity + ')' : ''}</span></div>`;
            }, '')}\`` : `Array.from({ length: nlapiGetLineItemCount('item') }, (_, i) => i).reduce((html, line) => {
                                var item = nlapiGetLineItemValue('item', 'item', line + 1);
                                var item_display = nlapiGetLineItemValue('item', 'item_display', line + 1);
                                var itemtype = nlapiGetLineItemValue('item', 'itemtype', line + 1);
                                return itemtype !== 'Assembly' ? html : html += \`<div class="scroll-line" data-item-id=\${item}><span class="scroll-item">\${item_display}</span><span class="scroll-qty">\${quantity > 1 ? ' (' + quantity + ')' : ''}</span></div>\`
                            }, '')`)};
                        const input = document.querySelector('#item-input');
                        async function getBuildableDetails(subsidiaryid, locationid, itemid, nfp) {
                            var start = new Date().getTime();
                            var buildables = await fetch('/app/site/hosting/scriptlet.nl?script=259&deploy=1', {
                                method: 'POST',
                                body: JSON.stringify({ locationid, subsidiaryid, itemids: itemid, nfp })
                            }).then(response => response.json())
                            
                            
                            var tbody = document.getElementById('component-table-body');
                            tbody.innerHTML = '';
                            for (bom of buildables[itemid[0]].boms) {

                                tbody.innerHTML += \`
                                    <tr>
                                        <td class="bom-cell">\${bom.name.split('(')[1].split(')')[0]/* + (bom.isDefault ? '*' : '')*/}</td>
                                        <td class="req-cell">
                                            \${bom.components.map(comp => \`<div>\${comp.quantity}</div>\`).join('')}
                                        </td>
                                        <td class="avail-cell">
                                            \${bom.components.map(comp => \`<div>\${comp.locationquantityavailable || 0}</div>\`).join('')}
                                        </td>
                                        <td class="comp-cell">
                                            \${bom.components.map(comp => \`<div>\${comp.name}</div>\`).join('')}
                                        </td>
                                    </tr>
                                \`;
                            }
                        }
                        input.addEventListener('change', e => {
                           
                            if (input.value) {
                                require(['N/search'], search => {
                                    itemid[0] = search.create({
                                        type: 'item',
                                        filters: ['name', 'is', input.value]
                                    }).run().getRange({ start: 0, end: 1 })[0].id;
                                    if (subsidiaryid && locationid && itemid[0]) {
                                        getBuildableDetails(subsidiaryid, locationid, itemid, nfp)
                                    }
                                })
                            }
                        })
                        div.addEventListener('click', e => {
                            
                            if (['download-csv', 'scroll-line', 'scroll-item', 'scroll-qty', 'location-name', 'location-tab', 'nfp-checkbox'].includes(e.target.className)) {
                               
                                if (e.target.className == 'download-csv' && subsidiaryid && locationid) {
                                    (async function () {
                                       
                                        var buildables = await fetch('/app/site/hosting/scriptlet.nl?script=259&deploy=1', {
                                            method: 'POST',
                                            body: JSON.stringify({ 
                                                locationid, 
                                                subsidiaryid, 
                                                itemids: ${JSON.stringify(Array.from({ length: newRecord.getLineCount('item') }, (_, i) => i).map(line => ({
                item: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }),
                itemtype: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line })
            })).filter(item => ['Assembly', 'InvtPart'].includes(String(item.itemtype))).map(item => item.item))}, 
                                                nfp 
                                            })
                                        }).then(response => response.json())
                                        
                                        const data = ${JSON.stringify((Array.from({ length: newRecord.getLineCount('item') }, (_, i) => i).map(line => ({
                row: [
                    line + 1,
                    newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }),
                    newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item_display', line }),
                    newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line })
                ],
                itemtype: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line })
            })).filter(item => ['Assembly', 'InvtPart'].includes(String(item.itemtype))).map(item => item.row)))};
                                        
                                        const groupData = data.reduce((acc, val) => {
                                            const item = val[1];
                                            const existing = acc.find(item => item[1] == val[1]);
                                            if (!existing) { acc.push(val); }
                                            else { existing[3] += val[3] }
                                            return acc;
                                        }, []);
                                        
                                        const csvLines = [[[['Line', 'Item ID', 'Item', 'Qty', 'BOM', 'Default', 'Component', 'BOM Required', 'Available', 'Total Required']]]].concat(groupData.map(lineDetails => {
                                            const [line, id, item, quantity] = lineDetails;
                                            return buildables[id]?.boms.map(bom => (bom.components.reduce((acc, val) => {
                                                return acc.concat([lineDetails.concat(
                                                    bom.name.slice(bom.name.indexOf('(') + 1, bom.name.indexOf(')')),
                                                    bom.isDefault ? 'T' : '',
                                                    val.name,
                                                    val.quantity,
                                                    val.locationquantityavailable,
                                                    val.quantity * quantity
                                                )]);
                                            }, [])));
                                        })).flat().flat();

                                        
                                        const csvContent = csvLines.map(row => row.join(',')).join('\\n');
                                        const blob = new Blob([csvContent], { type: 'text/csv' });
                                        const url = URL.createObjectURL(blob);

                                        // Create and trigger the download
                                        const a = document.createElement('a'); // Temporary element
                                        a.href = url;
                                        a.download = 'products.csv'; // File name
                                        a.click(); // Trigger download

                                        // Cleanup
                                        URL.revokeObjectURL(url);
                                    }());
                                }
                                else if (e.target.className == 'nfp-checkbox') {
                                    nfp = e.target.checked;
                                }
                                else if (e.target.className == 'scroll-line') {
                                    itemid[0] = e.target.getAttribute('data-item-id')
                                    input.value = e.target.childNodes[0].innerText;
                                }
                                else if (['scroll-item', 'scroll-qty'].includes(e.target.className)) {
                                    itemid[0] = e.target.parentElement.getAttribute('data-item-id');
                                    input.value = e.target.parentElement.childNodes[0].innerText;
                                }
                                else if (e.target.className == 'location-name' || e.target.className == 'location-tab') {
                                    for (var tab of document.querySelectorAll('.location-name')) {
                                        tab.style.backgroundColor = 'silver';
                                        tab.style.color = 'white';
                                        tab.style.borderBottom = '1px solid #ddd';
                                    }
                                    locationid = e.target.getAttribute('data-location-id');
                                    e.target.closest('.location-name').style.backgroundColor = 'white';
                                    e.target.style.color = 'black';
                                    e.target.style.borderBottom = 'none';
                                }
                                if (subsidiaryid && locationid && itemid[0]) {
                                    getBuildableDetails(subsidiaryid, locationid, itemid, nfp)
                                }
                            }
                        });
                        document.querySelector('.nfp-checkbox').checked = nfp;
                        document.querySelector(\`.location-name[data-location-id="\${locationid}"]\`).click();
                    })

                    // When the user clicks anywhere outside of the modal, close it
                    window.addEventListener('click', function(event) {                        var overlay = document.getElementById("buildable-modal-overlay");
                        if (event.target == overlay) {
                            document.getElementById('view-buildable-modal').remove();
                        }
                    });
                    })();
                </script>
            `;
        }
        catch (e) {
            //@ts-ignore
            log.error('@NKUEConsolidateSourcedFields', e.message);
        }
        try {
            var start = new Date().getTime();
            var { newRecord, form, type, UserEventType } = context;
            var lineCount = newRecord.getLineCount('item');
            if (!lineCount) {
                return;
            }
            // Section 2: Because this information is cleared (via workflow after this script runs) for sales orders that are created from quotes yet we still need it to conditionally require a backorder ship date
            // newRecord.setValue only works on create anyway (in before submit scripts) but might as well wrap it inside of an if statement
            if (type == UserEventType.CREATE || type == UserEventType.COPY) {
                var buildableRes = Array.from({ length: lineCount }, (_, i) => i).filter(line => ['Assembly', 'InvtPart'].includes(String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line }))));
                var buildables = buildableRes.map(line => newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_buildable', line }));
                var custbody_nk_json;
                try {
                    custbody_nk_json = JSON.parse(String(newRecord.getValue({ fieldId: 'custbody_nk_json' })));
                }
                catch (e) {
                    custbody_nk_json = {};
                }
                custbody_nk_json.original_buildables = buildables;
                newRecord.setValue({ fieldId: 'custbody_nk_json', value: JSON.stringify(custbody_nk_json) });
            }
            var items = [];
            var woids = [];
            var uncommitted = 0;
            for (var line = 0; line < lineCount; line++) {
                items.push({
                    item: String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line })),
                    itemtype: String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line })),
                    quantity: Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line })) || 0,
                    quantitycommitted: Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantitycommitted', line })) || 0,
                    quantityfulfilled: Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantityfulfilled', line })) || 0,
                });
                var woid = String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'woid', line }));
                if (woid) {
                    woids.push(woid);
                }
            }
            if (!items.length) {
                const tranid = newRecord.getValue('tranid');
            }
            try {
                form.getField({ id: 'custbody_yy_wocount' }).defaultValue = String(woids.length);
            }
            catch (e) { }
            var start = new Date().getTime();
            var results = getAllResults(search.create({
                type: 'item',
                filters: [
                    ['internalid', 'anyof', items.map(item => item.item)]
                ],
                columns: [
                    'custitem_mb_inventorytype',
                    'custitem_mb_item_group',
                    'custitem_mb_cubicfeet',
                    'weight',
                    'custitem_mb_hinges',
                    'custitem_mb_glides',
                    'isfulfillable'
                ]
            }).run()).map(result => ({
                item: String(result.id),
                weight: Number(result.getValue('weight')) || 0,
                custitem_mb_item_group: String(result.getValue('custitem_mb_item_group')),
                custitem_mb_hinges: Number(result.getValue('custitem_mb_hinges')) || 0,
                custitem_mb_glides: Number(result.getValue('custitem_mb_glides')) || 0,
                custitem_mb_inventorytype: String(result.getValue('custitem_mb_inventorytype')),
                custitem_mb_cubicfeet: Number(result.getValue('custitem_mb_cubicfeet')) || 0,
                isfulfillable: Boolean(result.getValue('isfulfillable'))
            }));
            var cabinets = 0;
            var accessories = 0;
            var cubicfeet = 0;
            var weight = 0;
            var hinges = 0;
            var glides = 0;
            for (var item of items) {
                var details = results.find(result => result.item == item.item);
                if (!details) {
                    if (item.itemtype != 'Subtotal') {
                        const tranid = newRecord.getValue('tranid');
                    }
                }
                else {
                    hinges += details.custitem_mb_hinges * item.quantity;
                    glides += details.custitem_mb_glides * item.quantity;
                    cubicfeet += details.custitem_mb_cubicfeet * item.quantity;
                    weight += details.weight * item.quantity;
                    if (details.custitem_mb_item_group == '1') {
                        cabinets += item.quantity;
                    }
                    if (details.custitem_mb_inventorytype == '14') {
                        accessories += item.quantity;
                    }
                    if (details.isfulfillable) {
                        uncommitted += item.quantity - item.quantityfulfilled - item.quantitycommitted;
                    }
                }
            }
            try {
                form.getField({ id: 'custbody_mb_so_cabinets_on_order' }).defaultValue = String(cabinets);
            }
            catch (e) { }
            try {
                form.getField({ id: 'custbody_mb_so_accessories_on_order' }).defaultValue = String(accessories);
            }
            catch (e) { }
            try {
                form.getField({ id: 'custbody_mb_cubic_feet_on_order' }).defaultValue = String(cubicfeet.toFixed(2));
            }
            catch (e) { }
            try {
                form.getField({ id: 'custbody_mb_so_total_weight' }).defaultValue = String(weight.toFixed(2));
            }
            catch (e) { } // Add to transfers with separate criteria
            try {
                form.getField({ id: 'custbody_mb_so_hinges' }).defaultValue = String(hinges);
            }
            catch (e) { }
            try {
                form.getField({ id: 'custbody_mb_so_glides' }).defaultValue = String(glides);
            }
            catch (e) { }
            try {
                form.getField({ id: 'custbody_yy_so_uncommitted' }).defaultValue = String(uncommitted);
            }
            catch (e) { }
            try {
                newRecord.setValue({ fieldId: 'custbodymb_cubic_ft_saved_search', value: cubicfeet.toFixed(2) });
            }
            catch (e) { }
            const duration = Date.now() - start;
            if (duration >= 100) {
                //log.debug('@NKUEConsolidateSourcedFields: lengthy duration', duration);
            }
        }
        catch (e) {
            log.error('@NKUEConsolidateSourcedFields', e.message);
        }
    }
    function getLeadTimeHTML(id, context) {
        var { newRecord, type, form } = context;
        return `
        <button id="open-lead-time-view">View Lead Time Details</button>
        <script>
            (function() {
                var html = \`
                    <style>
                        #lead-time-modal-overlay {
                            display: flex;
                            justify-content: space-around;
                            align-items: center;
                            position: fixed;
                            z-index: 1102;
                            left: 0;
                            top: 0;
                            width: 100%;
                            height: 100%;
                            overflow: auto;
                            background-color: rgb(0,0,0);
                            background-color: rgba(0,0,0,0.4);
                            /* Override x4labs styles */
                            color: black;
                            font-size: 12px;
                            font-family: tahoma, arial, verdana, sans-serif;
                            -webkit-font-smoothing: antialiased;
                        }
                        
                        #lead-time-modal {
                            font-family: Arial, sans-serif;
                            width: 35%;
                            height: 40%;
                            border-radius: 10px;
                            background-color: #fff;
                            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        
                        #lead-time-table-side {
                            height: 100%;
                            width: 100%;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            overflow: auto;
                        }
                        
                        @media (max-width: 1500px) {
                            #buildable-modal {
                                width: 40%;
                            }
                        }
                        
                        .location-tabs {
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        
                        #lead-time-scroll-wheel {
                            display: flex;
                            flex: 25%;
                            flex-direction: column;
                            height: 100%;
                            overflow-x: hidden;
                            overflow-y: scroll;
                            scrollbar-width: thin;
                            scrollbar-color: #888 #ccc;
                        }
                        
                        #lead-time-scroll-wheel::-webkit-scrollbar {
                            width: 8px;
                        }
                        
                        #lead-time-scroll-wheel::-webkit-scrollbar-thumb {
                            background-color: #888;
                            border-radius: 10px;
                        }
                        
                        #lead-time-scroll-wheel::-webkit-scrollbar-track {
                            background-color: #ccc;
                            border-radius: 10px;
                        }
                        
                        .scroll-line {
                            padding: 10px;
                            border-bottom: 1px solid #eee;
                            transition: transform 0.2s, color 0.2s;
                            color: #888;
                        }
                        
                        .scroll-line:last-child {
                            border-bottom: none;
                        }
                        
                        .scroll-line, .scroll-line span {
                            cursor: pointer;
                        }
                        
                        .scroll-line.selected {
                            transform: scale(1.5);
                            color: #000;
                        }

                        #lead-time-component-table {
                            overflow: hidden;
                            display: flex;
                            flex-direction: column;
                            height: 100%;
                        }
                        
                        .lead-time-location-tab {
                            width: 20%;
                            box-sizing: border-box;
                            position: relative;
                        }
                        
                        #lead-time-input-header {
                            width: 100%;
                            padding: 10px;
                            display: flex;
                            justify-content: space-around;
                            align-items: center;
                        }
                        
                        .table-container {
                            width: 100%;
                        }
                        
                        .day-cell {
                            width: 6.5%;
                            padding: 1px;
                        }
                        
                        .date-cell {
                            width: 15%;
                            padding: 1px;
                        }
                        
                        .item-cell {
                            width: 30%;
                            padding: 1px;
                        }
                        
                        th.ship-cell, th.date-cell {
                            text-align: center;
                        } 
                        
                        .lead-time-table-row { 
                            display: flex;
                            width: 100%; 
                        }
                        
                        #lead-time-component-table-body {
                            height: 100%;
                            display: flex;
                            flex-direction: column;
                            overflow: hidden;
                            overflow-y: auto;
                            scrollbar-width: thin;
                            scrollbar-color: #888 #ccc;
                        }
                        
                        .lead-time-location-name {
                            cursor: default;
                            padding: 20px;
                            top: 0;
                            bottom: 0;
                            left: 0;
                            right: 0;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            background-color: silver;
                            color: white;
                            border: 1px solid #ddd;
                        }
                        
                        #lead-time-component-table-body tr:nth-child(even) {
                            background-color: #f2f2f2;
                        }
                    </style>
                    <div id="lead-time-modal-overlay">
                        <div id="lead-time-modal">
                            <div id="lead-time-scroll-wheel"></div>
                            <div id="lead-time-table-side">
                                <div id="lead-time-input-header">
                                    <input type="text" id="lead-time-item-input">
                                    ${type == context.UserEventType.VIEW ? '<button class="download-csv">csv</button>' : ''}
                                </div>
                                <div class="table-container">
                                    <div class="location-tabs">
                                        <div class="lead-time-location-tab">
                                            <div class="lead-time-location-name" data-location-id="lead-time-7">NJ</div>
                                        </div>
                                        <div class="lead-time-location-tab">
                                            <div class="lead-time-location-name" data-location-id="lead-time-10">NV</div>
                                        </div>
                                        <div class="lead-time-location-tab">
                                            <div class="lead-time-location-name" data-location-id="lead-time-11">FL</div>
                                        </div>
                                        <div class="lead-time-location-tab">
                                            <div class="lead-time-location-name" data-location-id="lead-time-12">TX</div>
                                        </div>
                                        <div class="lead-time-location-tab">
                                            <div class="lead-time-location-name" data-location-id="lead-time-16">SC</div>
                                        </div>
                                    </div>
                                    <table id="lead-time-component-table">
                                        <thead>
                                            <tr class="lead-time-table-row">
                                                <th class="day-cell item-cell">ITEM</th>
                                                <th class="day-cell">🛠️</th>
                                                <th class="day-cell">MD</th>
                                                <th class="day-cell">FG</th>
                                                <th class="day-cell">BO</th>
                                                <th class="day-cell">CP</th>
                                                <th class="day-cell">TN1</th>
                                                <th class="day-cell">TN2</th>
                                                <th class="day-cell">TN3</th>
                                                <th class="day-cell ship-cell">🚢</th>
                                                <th class="day-cell">TOTAL</th>
                                                <th class="day-cell date-cell">📅</th>
                                            </tr>
                                        </thead>
                                        <tbody id="lead-time-component-table-body"></tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                \`
                console.log(document.getElementById('open-lead-time-view'));
                document.getElementById('open-lead-time-view').addEventListener('click', e => {
                    require(['N/currentRecord', 'SuiteScripts/cnc-inhouse-scripts/production-capacity-leadtimes/new_lead_times.js'], (currentRecord, utils) => {
                        const { getLeadTime } = utils;
                        function populateLeadTimes(curRecord, lines, rushed=false) {
                            const location = Number(curRecord.getValue({ fieldId: 'location' }));
                            const shipmethod = curRecord.getValue({ fieldId: 'shipmethod' });
                            const itemtypes = ['Assembly', 'Inventory', 'InvtPart'];
                            const rush = curRecord.getValue({ fieldId: 'custbody_mb_so_add_on_accessories' }) || rushed;
                            const ltInfo = [];
                            let modifications = {
                                'custcol_yy_mod_boxonly': 2, 'custcol_yy_mod_chase': 5,
                                'custcol_mb_so_cut_down_extend': 5, 'custcol_yy_mod_sinkbase': 2,
                                'custcol_yy_mod_custom_color': 10, 'custcol_yy_mod_cut_extend': 5,
                                'custcol_yy_mod_custom_item': 10, 'custcol_mb_so_custom_modification': 10,
                                'custcol_mb_so_cut_for_glass': 5, 'custcol_yy_mod_cutdown': 5,
                                'custcol_yy_mod_toekick': 5, 'custcol_er_mod_cutwidth': 5,
                                'custcol_yy_mod_extend': 5, 'custcol_mb_so_finished_interior': 5,
                                'custcol_nk_mod_finishedside': 2, 'custcol_nk_mod_fulldepthshelf': 2,
                                'custcol_nk_mod_hingeside': 2, 'custcol_er_mod_hood': 5,
                                'custcol_yy_mod_cplus_color': 10, 'custcol_er_mod_cplus_stain': 10,
                                'custcol_yy_mod_revashelf': 10, 'custcol_yy_mod_revashelf_2': 10,
                                'custcol_yy_mod_revashelf_3': 10, 'custcol_nk_mod_samplematch': 5,
                                'custcol_nk_mod_single_df': 2, 'custcol_mb_con_wall_cut_down_extend': 5
                            };
                            for (const line of lines) {
                                const itemtype = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line }));
                                if (itemtypes.includes(itemtype)) {
                                    let hasMods = false;
                                    const item = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line });
                                    const quantity = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line });
                                    let mods = Object.keys(modifications).reduce((acc, val) => {
                                        //@ts-ignore
                                        const option = nlapiGetLineItemValue( 'item', val, line+1 );
                                        if (option) {
                                            acc[val] = option;
                                            hasMods = true;
                                        }
                                        return acc;
                                    }, {});

                                    ltInfo.push({ item, quantity, location, shipmethod, rush, mods, line, hasMods });

                                }
                            }
                            const leadTimeDict = getLeadTime(ltInfo);
                            const lineLeadTimeFullDetails = ltInfo.map(line => Object.assign(line, leadTimeDict[line.item], { leadtime: line.hasMods ? line.modshipdate : line.shipdate }));
                            // For displaying a lead time popup
                            return { leadTimeDict, lineLeadTimeFullDetails };
                        }
                        const lineCount = currentRecord.get().getLineCount('item');  
                        const lines = Array.from({ length: lineCount }, (_, i) => i);
                        const response = populateLeadTimes(currentRecord.get(), lines);
                        console.log(response);
                        const { lineLeadTimeFullDetails } = response; 
                        const tbody = document.querySelector('#lead-time-component-table-body');
                        tbody.innerHTML = lineLeadTimeFullDetails.map(({ itemid, name, moddays, bo, stddays, transferDays, lineLeadTime, transferDetails }) => \`
                            <tr class="lead-time-table-row">
                                <td class="day-cell item-cell">\${itemid}</td>
                                <td class="day-cell">\${stddays}</td>
                                <td class="day-cell">\${moddays || ''}</td>
                                <td class="day-cell">\${bo || ''}</td>
                                <td class="day-cell"></td>
                                <td class="day-cell"></td>
                                <td class="day-cell">\${(transferDetails.departure + transferDetails.blackout) || ''}</td>
                                <td class="day-cell">\${transferDetails.transit || ''}</td>
                                <td class="day-cell">\${transferDetails.unload || ''}</td>
                                <td class="day-cell ship-cell"></td>
                                <td class="day-cell">\${Math.max(stddays, moddays || 0, bo || 0) + (transferDays || 0)}</td>
                                <td class="day-cell date-cell">\${lineLeadTime}</td>
                            </tr>
                        \`).join('');
                    })
                    e.preventDefault();
                    var body = document.querySelector('body');
                    var div = document.createElement('div');
                    div.id = 'view-lead-time-modal';
                    div.innerHTML = html;
                    body.append(div);
                    var itemid = [];
                    var subsidiaryid = ${type == context.UserEventType.VIEW ? newRecord.getValue('subsidiary') : `nlapiGetFieldValue('subsidiary')`};
                    var locationid = ${type == context.UserEventType.VIEW ? newRecord.getValue('location') : `nlapiGetFieldValue('location')`};
                    var nfp = ${type == context.UserEventType.VIEW ? newRecord.getValue('custbody_yy_nfp') : `nlapiGetFieldValue('custbody_yy_nfp')`};
                    var scrollWheel = document.getElementById('lead-time-scroll-wheel');
                    scrollWheel.innerHTML = ${(context.type == context.UserEventType.VIEW ? `\`${Array.from({ length: newRecord.getLineCount('item') }, (_, i) => i).reduce((html, line) => {
            var item = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line });
            var item_display = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item_display', line });
            var quantity = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line });
            var itemtype = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line });
            return itemtype !== 'Assembly' ? html : html += `<div class="scroll-line" data-item-id=${item}><span class="scroll-item">${item_display}</span><span class="scroll-qty">${quantity || 0 > 1 ? ' (' + quantity + ')' : ''}</span></div>`;
        }, '')}\`` : `Array.from({ length: nlapiGetLineItemCount('item') }, (_, i) => i).reduce((html, line) => {
                                            var item = nlapiGetLineItemValue('item', 'item', line + 1);
                                            var item_display = nlapiGetLineItemValue('item', 'item_display', line + 1);
                                            var itemtype = nlapiGetLineItemValue('item', 'itemtype', line + 1);
                                            return itemtype !== 'Assembly' ? html : html += \`<div class="scroll-line" data-item-id=\${item}><span class="scroll-item">\${item_display}</span><span class="scroll-qty">\${quantity > 1 ? ' (' + quantity + ')' : ''}</span></div>\`
                                        }, '')`)};
                    const input = document.querySelector('#lead-time-item-input');
                    console.log(input);
                    input.addEventListener('change', e => {
                        console.log('input changed')
                        if (input.value) {
                            require(['N/search'], search => {
                                itemid[0] = search.create({
                                    type: 'item',
                                    filters: ['name', 'is', input.value]
                                }).run().getRange({ start: 0, end: 1 })[0].id;
                                if (subsidiaryid && locationid && itemid[0]) {
                                    getBuildableDetails(subsidiaryid, locationid, itemid, nfp)
                                }
                            })
                        }
                    })
                    console.log(div);
                    div.addEventListener('click', e => {
                        console.log(e.target.className);
                        if (['download-csv', 'scroll-line', 'scroll-item', 'scroll-qty', 'lead-time-location-name', 'lead-time-location-tab', 'nfp-checkbox'].includes(e.target.className)) {
                            console.log(subsidiaryid, locationid, itemid, nfp);
                            if (e.target.className == 'download-csv' && subsidiaryid && locationid) {
                                (async function () {
                                    console.log('download-csv');
                                    var buildables = await fetch('/app/site/hosting/scriptlet.nl?script=259&deploy=1', {
                                        method: 'POST',
                                        body: JSON.stringify({ 
                                            locationid, 
                                            subsidiaryid, 
                                            itemids: ${JSON.stringify(Array.from({ length: newRecord.getLineCount('item') }, (_, i) => i).map(line => ({
            item: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }),
            itemtype: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line })
        })).filter(item => ['Assembly', 'InvtPart'].includes(String(item.itemtype))).map(item => item.item))}, 
                                            nfp 
                                        })
                                    }).then(response => response.json())
                                    console.log('buildables', buildables);
                                    const data = ${JSON.stringify((Array.from({ length: newRecord.getLineCount('item') }, (_, i) => i).map(line => ({
            row: [
                line + 1,
                newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }),
                newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item_display', line }),
                newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line })
            ],
            itemtype: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line })
        })).filter(item => ['Assembly', 'InvtPart'].includes(String(item.itemtype))).map(item => item.row)))};
                                    
                                    const groupData = data.reduce((acc, val) => {
                                        const item = val[1];
                                        const existing = acc.find(item => item[1] == val[1]);
                                        if (!existing) { acc.push(val); }
                                        else { existing[3] += val[3] }
                                        return acc;
                                    }, []);
                                    
                                    const csvLines = [[[['Line', 'Item ID', 'Item', 'Qty', 'BOM', 'Component', 'BOM Required', 'Available', 'Total Required']]]].concat(groupData.map(lineDetails => {
                                        const [line, id, item, quantity] = lineDetails;
                                        return buildables[id]?.boms.map(bom => (bom.components.reduce((acc, val) => {
                                            return acc.concat([lineDetails.concat(
                                                bom.name.slice(bom.name.indexOf('(') + 1, bom.name.indexOf(')')),
                                                val.name,
                                                val.quantity,
                                                val.locationquantityavailable,
                                                val.quantity * quantity
                                            )]);
                                        }, [])));
                                    })).flat().flat();

                                    console.log(groupData);
                                    console.log(csvLines);
                                    console.log(buildables);
                                    console.log('boms', Object.values(buildables).map(information => information.boms));
                                    
                                    const csvContent = csvLines.map(row => row.join(',')).join('\\n');
                                    const blob = new Blob([csvContent], { type: 'text/csv' });
                                    const url = URL.createObjectURL(blob);

                                    // Create and trigger the download
                                    const a = document.createElement('a'); // Temporary element
                                    a.href = url;
                                    a.download = 'products.csv'; // File name
                                    a.click(); // Trigger download

                                    // Cleanup
                                    URL.revokeObjectURL(url);
                                }());
                            }
                            else if (e.target.className == 'nfp-checkbox') {
                                nfp = e.target.checked;
                            }
                            else if (e.target.className == 'scroll-line') {
                                console.log(e.target.getAttribute('data-item-id'));
                                itemid[0] = e.target.getAttribute('data-item-id')
                                input.value = e.target.childNodes[0].innerText;
                            }
                            else if (['scroll-item', 'scroll-qty'].includes(e.target.className)) {
                                console.log(e.target.parentElement.getAttribute('data-item-id'));
                                itemid[0] = e.target.parentElement.getAttribute('data-item-id');
                                input.value = e.target.parentElement.childNodes[0].innerText;
                            }
                            else if (e.target.className == 'lead-time-location-name' || e.target.className == 'lead-time-location-tab') {
                                for (var tab of document.querySelectorAll('.lead-time-location-name')) {
                                    tab.style.backgroundColor = 'silver';
                                    tab.style.color = 'white';
                                    tab.style.borderBottom = '1px solid #ddd';
                                }
                                locationid = e.target.getAttribute('data-location-id');
                                e.target.closest('.lead-time-location-name').style.backgroundColor = 'white';
                                e.target.style.color = 'black';
                                e.target.style.borderBottom = 'none';
                            }
                            if (subsidiaryid && locationid && itemid[0]) {
                                getBuildableDetails(subsidiaryid, locationid, itemid, nfp)
                            }
                        }
                    });
                    // document.querySelector('.nfp-checkbox').checked = nfp;
                    document.querySelector(\`.lead-time-location-name[data-location-id="lead-time-\${locationid}"]\`).click();
                })

                // When the user clicks anywhere outside of the modal, close it
                window.addEventListener('click', function(event) {
                    var overlay = document.getElementById("lead-time-modal-overlay");
                    if (event.target == overlay) {
                        document.getElementById('view-lead-time-modal').remove();
                    }
                })
            })();
        </script>
    `;
    } // Support function for NKUESOAddCalendarButton
    function getCalendarHTML(id, context) {
        var { newRecord, type, form } = context;
        return `
        <style>
            #modal-overlay {
                display: flex;
                justify-content: space-around;
                align-items: center;
                position: fixed;
                z-index: 1102;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                overflow: auto;
                background-color: rgb(0,0,0);
                background-color: rgba(0,0,0,0.4);
                /* Override x4labs styles */
                color: black;
                font-size: 12px;
                font-family: tahoma, arial, verdana, sans-serif;
                -webkit-font-smoothing: antialiased;
            }
            
            .calendar-modal {
                display: flex;
                flex-direction: column;
                min-height: 65%;
                width: 30%;
                border: 1px solid #ccc;
                border-radius: 10px;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                background-color: white;
                padding: 10px;
            }

            .calendar-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px;
            }

            .calendar-body {
                display: flex;
                flex-direction: column;
                flex-grow: 1;
            }

            .calendar-options { 
                display: grid;
                grid-template: 2fr 2fr / 2fr 2fr 1fr;
                gap: 5px;
            }

            .calendar-options > div { 
                position: relative;
                display: flex;
                flex-direction: column;
            }

            #monthYear {
                font-size: 18px;
                font-weight: bold;
            }
            /*
            #${id} {
                background-color: silver;
                border: none;
                font-size: 18px;
                cursor: pointer;
            }
            */
            .dropdown {
                position: relative;
                width: 200px;
            }

            .dropdown input {
                width: 100%;
                padding: 8px;
                box-sizing: border-box;
                cursor: pointer;
            }

            .dropdown-options {
                position: absolute;
                top: 100%;
                max-height: 150px;
                overflow-y: auto;
                background-color: white;
                border: 1px solid #ccc;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
                display: none;
                z-index: 1;
            }

            /* Option style */
            .dropdown-options div {
                padding: 8px;
                cursor: pointer;
            }

            /* Hover effect for options */
            .dropdown-options div:hover {
                background-color: #f0f0f0;
            }
            .days-of-week {
                display: flex;
                justify-content: space-between;
                font-weight: bold;
                padding: 10px 0;
            }

            .days-grid {
                flex-grow: 1;
                display: grid;
                grid-template-columns: repeat(7, 1fr);
                grid-template-rows: repeat(6, 1fr);
            }

            .days-grid > div {
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                text-align: right;
                border: 1px solid silver;
                position: relative;
            }

            .days-grid div span {
                padding: 0 2px;
            }

            .days-grid div > span:first-child {
                display: flex;
                justify-content: space-between;
                padding: 2px 2px 0 2px;
            }

            .days-grid div > span:last-child {
                padding: 0 2px 2px 2px;
            }

            .days-grid div:hover {
                cursor: pointer;
            }

            .bad-truck-day {
                background-color: #ffffe5;
            }

            .inactive-day {
                color: #ccc;
            }

            .today > span:first-child {
                background-color: #4caf50;
                color: white;
            }

            .buildable-lead-time > span:first-child {
                background-color: #cfc;
            }

            .collection-sd-lead-time > span:first-child {
                background-color: #ccf;
            }

            .collection-bo-lead-time > span:first-child {
                background-color: #cff;
            }

            .collection-lo-lead-time > span:first-child {
                background-color: #ffc;
            }

            .latest-lead-time > span:first-child {
                background-color: #cfc;
            }

            .pre-leadtime-date {
                background-color: #fff2e5;
            }

            .past-date {
                background-color: #e5cce5;
            }

            .leadtime-date {
                background-color: #f2ffe5;
            }
            
            .maxed-out-date {
                background-color: #fcc;
            }

            .blackout-day {
                background-color: #eee;
            }

            .blackout-date {
                background-color: darkgrey;
                color: white;
            }
            
            #ship-amount-display {
                font-weight: bold;
            }

            .hover-div {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(255, 255, 255, 0.4); /* Optional hover overlay */
                visibility: hidden;
                transition: opacity 0.2s ease, visibility 0.2s ease;
            }

            .days-grid div:hover .hover-div {
                visibility: visible;
            }

            .days-grid div:hover .hover-div .hover-opacity {
                opacity: 1;
            }


        </style>
        <button id="${id}">View Shipping Schedule</button>
        <script>
            var openScheduleButton = document.getElementById('${id}');
            openScheduleButton.addEventListener('click', async e => {
                e.preventDefault();
                var modal = document.createElement('div');
                modal.id = 'prod-sched-modal';
                modal.innerHTML = \`
                    <div id="modal-overlay"> 
                        <div class="calendar-modal" id="calendar-modal">
                            <div id="warning"></div>
                            <div>
                                <div class="calendar-header" id="calendar-header">
                                    <button id="prevMonth">❮</button>
                                    <div id="monthYear"></div>
                                    <button id="nextMonth">❯</button>
                                </div>
                                <div class="calendar-options">
                                    <div id="classes-select">
                                        <label>Collection:</label>
                                        <input class="dropdown-input" id="capacity-input" readonly>
                                        <div class="dropdown-options" id="classes-dropdown">
                                            <div>Dart</div>
                                            <div>Con</div>
                                            <div>Cls</div>
                                            <div>All</div>
                                        </div>
                                    </div>
                                    <div>
                                        <label>Location:</label>
                                        <input id="location-input" value="${type == context.UserEventType.VIEW && newRecord.getText('location') || ''}" class="dropdown-input" readonly>
                                        <div class="dropdown-options" id="location-dropdown">
                                            <div>New Jersey</div>
                                            <div>Nevada</div>
                                            <div>Florida</div>
                                            <div>Texas</div>
                                            <div>South Carolina</div>
                                        </div>
                                    </div>
                                    <div>
                                        <label>Unbuilt Only:</label>
                                        <input id="unbuilt-only" type="checkbox">
                                    </div>
                                    <div>
                                        <label>Ship Method:</label>
                                        <input value="${type == context.UserEventType.VIEW && `${(newRecord.getText('shipmethod')) && '' || ''}${(newRecord.getText('custbody_yy_so_trucklist') && ' #' + newRecord.getText('custbody_yy_so_trucklist')) && '' || ''}` || newRecord.getValue('shipmethod')}">
                                    </div>
                                    <div>
                                        <label>Ship Zip:</label>
                                        <input value="${String(newRecord.getValue('shipzip')).split('-')[0] && '' || ''}">
                                    </div>
                                    <div>
                                        <label>Unshipped Only:</label>
                                        <input id="unshipped-only" type="checkbox" checked="true" disabled>
                                    </div>
                                </div>
                            </div>
                            <div class="calendar-body">
                                <div class="days-of-week">
                                    <div>Sun</div>
                                    <div>Mon</div>
                                    <div>Tue</div>
                                    <div>Wed</div>
                                    <div>Thu</div>
                                    <div>Fri</div>
                                    <div>Sat</div>
                                </div>
                                <div id="calendarDays" class="days-grid"></div>
                            </div>
                        </div>
                    </div>
                \`;
                document.querySelector('body').appendChild(modal);
                const monthNames = [
                    "January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December"
                ];

                function getCalendarDays(date) {
                    const currentMonth = date.getMonth();
                    const currentYear = date.getFullYear();

                    return [].concat(
                        Array.from({ length: new Date(currentYear, currentMonth, 1).getDay() }, (_, i) => ({
                            date: \`\${currentMonth || '12'}/\${new Date(currentYear, currentMonth, 0 - i).getDate()}/\${currentMonth ? currentYear : currentYear - 1}\`,
                            active: false,
                        })).reverse(),
                        Array.from({ length: new Date(currentYear, currentMonth + 1, 0).getDate() }, (_, i) => ({
                            date: \`\${currentMonth + 1}/\${i + 1}/\${currentYear}\`,
                            active: true,
                            today: i + 1 == new Date().getDate() && new Date().getMonth() == currentMonth && new Date().getFullYear() == currentYear ? true : false
                        })),
                        Array.from({ length: 42 - new Date(currentYear, currentMonth + 1, 0).getDate() - new Date(currentYear, currentMonth, 1).getDay() }, (_, i) => ({
                            date: \`\${(currentMonth + 2) % 12 || 12}/\${i + 1}/\${currentMonth != 11 ? currentYear : currentYear + 1}\`,
                            active: false
                        }))
                    );
                }
                
                const groups = {
                    'Dart': 1,
                    'Con': 2,
                    'Cls': 3,
                    'All': 4
                };
                const collections = {
                    'Dart': [3, 6],
                    'Con': [1],
                    'Cls': [2],
                    'All': [1, 2, 3, 6]
                };
                const locations = {
                    'New Jersey': '7',
                    'Nevada': '10',
                    'Florida': '11',
                    'Texas': '12',
                    'South Carolina': '16'
                };

                let currentDate = new Date();
                let outside = {};

                async function renderCalendar(state) {

                    outside = {
                        ...outside,
                        ...state
                    };
            
                    const { date, applicablecapacities, capacities, production, blackout, truck, shipping, leadTime, showproduction, overriddendates } = outside; 
                    let { selectedcapacity } = outside;
                    let location = locations[document.getElementById('location-input').value] || ${newRecord.getValue('location') || "''"};
                    console.log(outside);
                    
                    // if (classes) {
                    //     document.getElementById('classes-dropdown').innerHTML = classes.map(cncclass => \`
                    //         <div>\${cncclass.cncclass}</div>
                    //     \`).join('')
                    // }
                    
                    if (leadTime && leadTime.classesMissingLeadTimes.length) {
                        const innerHTML = \`*This order contains \${[...new Set(leadTime.classesMissingLeadTimes.map(cncclass => cncclass.name))].join(' ')} which do not have established lead times and may be subject to custom shipping timelines.\`
                        document.getElementById('warning').innerHTML = innerHTML;
                        // var warning = document.createElement('div');
                        // document.getElementById('calendar-modal').innerHTML = innerHTML.concat(document.getElementById('calendar-modal').innerHTML);
                    } else { document.getElementById('warning').innerHTML = ''; }
                    
                    selectedcapacity = selectedcapacity || leadTime && leadTime.latestLeadTime && leadTime.latestLeadTime.custrecord_nk_leadtime_max_group || '';
                    console.log('selectedcapacity', selectedcapacity);
                    if (applicablecapacities && document.getElementById('classes-select')) {
                        document.getElementById('classes-select').innerHTML = \`
                            <label>Collection:</label>
                            <input value="\${selectedcapacity}" class="dropdown-input" id="capacity-input">
                            <div class="dropdown-options" id="classes-dropdown">
                                <div>Dart</div>
                                <div>Con</div>
                                <div>Cls</div>
                                <div>All</div></div>
                            </div>
                        \`;
                    }
                    
                    
                    const monthYearEl = document.getElementById('monthYear');
                    const calendarDaysEl = document.getElementById('calendarDays');

                    const currentMonth = date.getMonth();
                    const currentYear = date.getFullYear();

                    // Set month and year in header
                    monthYearEl.innerText = ''.concat(monthNames[currentMonth]).concat(' ').concat(currentYear);

                    const calendarDays = getCalendarDays(date);
                    
                    console.log(calendarDays)
                    const ship = shipping && shipping.dates || {};
                    const defaultcapacity = selectedcapacity && capacities && capacities.find(capacity => capacity.id == locations[document.getElementById('location-input').value]) && capacities.find(capacity => capacity.id == locations[document.getElementById('location-input').value])[selectedcapacity]
                    const leadTimesByCollection = selectedcapacity && leadTime && leadTime.leadTimesByCollection && leadTime.leadTimesByCollection[selectedcapacity]
                    
                    calendarDaysEl.innerHTML = calendarDays.map(day => {
                        const overriddendate = overriddendates && overriddendates.find(date => date.location == location && date.group == groups[selectedcapacity] && date.date == day.date); console.log(overriddendate);
                        const matchingcapacity = overriddendate && overriddendate.limit || defaultcapacity;
                        const classes = [
                            leadTime && leadTime.latestBuildableLeadTime && leadTime.latestBuildableLeadTime.leadTimeDate == day.date && 'buildable-lead-time',
                            leadTime && leadTime.latestBackorderLeadTime && leadTime.latestBackorderLeadTime.leadTimeDate == day.date && 'backordered-lead-time',
                            !day.active && 'inactive-day', 
                            day.today && 'today', 
                            ${newRecord.getValue('shipmethod') == '16'} && truck && !truck.days[new Date(day.date).getDay()] && 'bad-truck-day',
                            !(new Date(day.date).getDay() % 6) && 'blackout-day', 
                            blackout && blackout.includes(day.date) && 'blackout-date',
                            new Date(day.date) < (new Date().setHours(0, 0, 0, 0)) && 'past-date',
                            leadTime && leadTime.date == day.date && 'leadtime-date',
                            leadTimesByCollection && leadTimesByCollection.SD && leadTimesByCollection.SD.length && leadTimesByCollection.SD.some(leadTime => leadTime && leadTime.leadTimeDate == day.date) && 'collection-sd-lead-time',
                            leadTimesByCollection && leadTimesByCollection.BO && leadTimesByCollection.BO.length && leadTimesByCollection.BO.some(leadTime => leadTime && leadTime.leadTimeDate == day.date) && 'collection-bo-lead-time',
                            leadTimesByCollection && leadTimesByCollection.LO && leadTimesByCollection.LO.length && leadTimesByCollection.LO.some(leadTime => leadTime && leadTime.leadTimeDate == day.date) && 'collection-lo-lead-time',
                            leadTime && leadTime.latestLeadTime && leadTime.latestLeadTime.leadTimeDate && new Date(leadTime.latestLeadTime.leadTimeDate) > new Date(day.date) && 'pre-leadtime-date',
                            shipping && shipping.dates[day.date] && matchingcapacity && shipping.dates[day.date] > matchingcapacity && 'maxed-out-date'
                        ];
                        const scheduled = production && production.find(value => Object.keys(value)[0] == day.date);
                        return \`
                            <div class="\${classes.filter(name => name).join(' ') || ''}">
                                <span>
                                    <span>\${''.concat(
                                        classes.includes('collection-sd-lead-time') && 'SD ' || '').concat(
                                        classes.includes('collection-bo-lead-time') && 'BO ' || '').concat(
                                        classes.includes('collection-lo-lead-time') && 'LO' || '')
                                    }</span>
                                    <span class="month-date">\${day.date.split('/')[1]}</span>
                                </span>
                                <span>\${showproduction && scheduled && 'Prod: ' + scheduled[day.date] || ''}</span>
                                <span>\${ship[day.date] && ('Ship: <span id="ship-amount-display">' + ship[day.date] + '</span>') || ''}</span>
                                <span>\${matchingcapacity && !classes.includes('blackout-day') && ''.concat(
                                    '<span>/</span>').concat(
                                    \`<span class="capacity-amount"\${location != '7' || ${[94242, 3, 124372, 86815, 3544, 3577].includes(Number(runtime.getCurrentUser().id))} ? ' contenteditable' : ''}>\`).concat(matchingcapacity).concat('</span>'
                                ).trim() || ''}</span>
                                ${context.type != context.UserEventType.VIEW && ([3, 1004, 1009, 1037, 1059].includes(Number(runtime.getCurrentUser().role)) || [94242, 124372, 91522, 3577, 21305].includes(Number(runtime.getCurrentUser().id))) ? `
                                <div class="hover-div">
                                    <div class="hover-opacity">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="black" stroke-width="2" class="bi bi-check" viewBox="0 0 16 16">
                                            <rect x="0" y="0" width="16" height="16" fill="lightblue" />
                                            <path d="M10.854 5.146a.5.5 0 0 1 0 .708L7.207 9.5l-1.5-1.5a.5.5 0 1 1 .707-.707l.793.793 3.147-3.146a.5.5 0 0 1 .707 0z"/>
                                        </svg>
                                    </div>
                                </div>` : ''}
                            </div>
                        \`;
                    }).join('');
                }
                document.getElementById('prevMonth').addEventListener('click', () => {
                    currentDate.setMonth(currentDate.getMonth() - 1);
                    renderCalendar({ date: currentDate });
                });

                document.getElementById('nextMonth').addEventListener('click', () => {
                    currentDate.setMonth(currentDate.getMonth() + 1);
                    renderCalendar({ date: currentDate });
                });

                modal.addEventListener('focusout', event => {
                    if (event.target.matches('.capacity-amount')) {
                        console.log('focusout .capacity-amount');
                        const date = getCalendarDays(outside.date)[[...event.target.parentElement.parentElement.parentElement.children].indexOf(event.target.parentElement.parentElement)].date;
                        console.log(date);
                        (async function() {
                            const id = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                                method: 'POST',
                                body: JSON.stringify({ 
                                    type: 'override',
                                    location: locations[document.getElementById('location-input').value],
                                    capacity: event.target.innerText,
                                    group: groups[document.getElementById('capacity-input').value],
                                    date
                                })
                            }).then(response => response.json());
                            console.log(id);

                            (async function() {
                                const overriddendates = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                                    method: 'POST',
                                    body: JSON.stringify({ 
                                        type: 'overriddendates',
                                        location: locations[document.getElementById('location-input').value]
                                    })
                                }).then(response => response.json());
                                console.log(overriddendates);
                                renderCalendar({ overriddendates });
                            })();
                        })();
                    }
                })

                // Toggle dropdown on input click
                modal.addEventListener('click', event => {
                    
                    // Close all dropdowns if clicking outside
                    document.querySelectorAll('.dropdown-options').forEach(dropdown => {
                        dropdown.style.display = 'none';
                    });

                    if (event.target.matches('#unbuilt-only')) { console.log('event');
                        (async function() {
                            const shipping = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                                method: 'POST',
                                body: JSON.stringify({ 
                                    type: 'shipping',
                                    location: locations[document.getElementById('location-input').value],
                                    collections: collections[document.getElementById('capacity-input').value],
                                    unbuilt: document.getElementById('unbuilt-only').checked,
                                    dates: ['${newRecord.getValue('shipdate') && new Date(String(newRecord.getValue('shipdate'))).toLocaleDateString('en-US')}']
                                })
                            }).then(response => response.json());
                            console.log(shipping);
                            renderCalendar({ 
                                shipping
                            });
                        })();
                    }
                    // Open clicked dropdown
                    else if (event.target.matches('.dropdown-input')) {
                        const dropdownOptions = event.target.nextElementSibling;
                        dropdownOptions.style.display = dropdownOptions.style.display === 'block' ? 'none' : 'block';
                        event.stopPropagation(); console.log('event.stopPropagation()');
                    }

                    // Handle option selection
                    if (event.target.matches('.dropdown-options div')) {
                        const input = event.target.closest('.dropdown-options').previousElementSibling;
                        input.value = event.target.textContent;
                        event.target.parentElement.style.display = 'none';
                        event.stopPropagation(); console.log('event.stopPropagation()');
                        if (event.target.matches('#location-dropdown div')) {
                            (async function() {
                                const shipping = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                                    method: 'POST',
                                    body: JSON.stringify({ 
                                        type: 'shipping',
                                        location: locations[event.target.textContent],
                                        collections: collections[document.getElementById('capacity-input').value],
                                        unbuilt: document.getElementById('unbuilt-only').checked,
                                        dates: ['${newRecord.getValue('shipdate') && new Date(String(newRecord.getValue('shipdate'))).toLocaleDateString('en-US')}']
                                    })
                                }).then(response => response.json());
                                console.log(shipping);
                                renderCalendar({ shipping });
                            })();
                            (async function() {
                                const leadTime = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                                    method: 'POST',
                                    body: JSON.stringify({ 
                                        type: 'leadtime',
                                        location: locations[event.target.textContent],
                                        items: ${JSON.stringify(Array.from({ length: newRecord.getLineCount('item') }, (_, i) => i).map(line => ({
            item: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }),
            buildable: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_buildable', line })
        })))}
                                    })
                                }).then(response => response.json());
                                renderCalendar({ leadTime });
                            })();
                        }
                        else if (event.target.matches('#classes-dropdown div')) {
                            renderCalendar({ selectedcapacity: event.target.innerText });
                            (async function() {
                                const shipping = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                                    method: 'POST',
                                    body: JSON.stringify({ 
                                        type: 'shipping',
                                        location: locations[document.getElementById('location-input').value],
                                        collections: collections[event.target.textContent],
                                        dates: ['${newRecord.getValue('shipdate') && new Date(String(newRecord.getValue('shipdate'))).toLocaleDateString('en-US')}']
                                    })
                                }).then(response => response.json());
                                console.log(shipping);
                                renderCalendar({ 
                                    shipping,
                                    selectedcapacity: event.target.textContent
                                });
                            })();
                            (async function() {
                                const leadTime = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                                    method: 'POST',
                                    body: JSON.stringify({ 
                                        type: 'leadtime',
                                        location: locations[document.getElementById('location-input').value],
                                        items: ${JSON.stringify(Array.from({ length: newRecord.getLineCount('item') }, (_, i) => i).map(line => ({
            item: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }),
            buildable: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_buildable', line })
        })))}
                                    })
                                }).then(response => response.json());
                                renderCalendar({ leadTime });
                            })();

                            (async function() {
                                const overriddendates = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                                    method: 'POST',
                                    body: JSON.stringify({ 
                                        type: 'overriddendates',
                                        location: locations[document.getElementById('location-input').value]
                                    })
                                }).then(response => response.json());
                                console.log(overriddendates);
                                renderCalendar({ overriddendates });
                            })();
                        }
                    }
                });

                // Initial render
                renderCalendar({ date: currentDate });

                document.getElementById('location-dropdown').addEventListener('change', () => renderCalendar({ location: e.target.value }));
                (async function() {
                    const capacities = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1&type=capacities').then(response => response.json());
                    renderCalendar({ capacities });
                })();
                
                (async function() {
                    const production = await fetch(\`/app/site/hosting/restlet.nl?script=2179&deploy=1&type=production&location=7&collection=LUXOR\`).then(response => response.json());
                    renderCalendar({ production });
                })();

                (async function() {
                    const applicablecapacities = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                        method: 'POST',
                        body: JSON.stringify({ 
                            type: 'applicablecapacities',
                            items: ${JSON.stringify(Array.from({ length: newRecord.getLineCount('item') }, (_, i) => i).map(line => newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line })))}
                        })
                    }).then(response => response.json());
                    renderCalendar({ applicablecapacities });
                })();

                (async function() {
                    const blackout = await fetch(\`/app/site/hosting/restlet.nl?script=2179&deploy=1&type=blackout&location=${newRecord.getValue('location') || '7'}\`).then(response => response.json());
                    renderCalendar({ blackout });
                })();

                (async function() {
                    const overriddendates = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                        method: 'POST',
                        body: JSON.stringify({ 
                            type: 'overriddendates',
                            location: ${newRecord.getValue('location') || "''"}
                        })
                    }).then(response => response.json());
                    console.log(overriddendates);
                    renderCalendar({ overriddendates });
                })();

                (async function() {
                    const truck = await fetch(\`/app/site/hosting/restlet.nl?script=2179&deploy=1&type=truck&zip=${String(newRecord.getValue('shipzip')).split('-')[0]}\`).then(response => response.json());
                    renderCalendar({ truck });
                })();

                (async function() {
                    const leadTime = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                        method: 'POST',
                        body: JSON.stringify({ 
                            type: 'leadtime',
                            location: ${newRecord.getValue('location') || "''"},
                            items: ${JSON.stringify(Array.from({ length: newRecord.getLineCount('item') }, (_, i) => i).map(line => ({
            item: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }),
            buildable: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_buildable', line })
        })))}
                        })
                    }).then(response => response.json());
                    renderCalendar({ leadTime });
                    let shipping;
                    if (leadTime && leadTime.latestLeadTime.custrecord_nk_leadtime_max_group) {
                        shipping = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                            method: 'POST',
                            body: JSON.stringify({ 
                                type: 'shipping',
                                location: locations[document.getElementById('location-input').value],
                                collections: collections[leadTime.latestLeadTime.custrecord_nk_leadtime_max_group],
                                dates: ['${newRecord.getValue('shipdate') && new Date(String(newRecord.getValue('shipdate'))).toLocaleDateString('en-US')}']
                            })
                        }).then(response => response.json());
                    } else { 
                        shipping = await fetch('/app/site/hosting/restlet.nl?script=2179&deploy=1', {
                        method: 'POST',
                        body: JSON.stringify({ 
                            type: 'shipping',
                            location: locations[document.getElementById('location-input').value],
                            dates: getCalendarDays(currentDate).map(date => date.date)
                        })
                    }).then(response => response.json());}
                    renderCalendar({ shipping });
                })();
            });
            window.addEventListener('click', function(event) {
                var overlay = document.getElementById("modal-overlay");
                if (event.target == overlay) {
                    document.getElementById('prod-sched-modal').remove();
                }
            });
        </script>
    `;
    } // Support function for NKUESOAddCalendarButton
    function NKUESOAddCalendarButton(context) {
        try {
            if (runtime.executionContext != runtime.ContextType.USER_INTERFACE) {
                return;
            }
            var startTime = Date.now();
            var { form } = context;
            form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue = '';
            form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue += getLeadTimeHTML('view-schedule', context);
            form.getField({ id: 'custbody_nk_view_schedule' }).defaultValue = getCalendarHTML('view-ship-schedule', context);
            const duration = Date.now() - startTime;
            //if (duration > 50) log.debug('@NKUESOAddCalendarButton: Total duration', Date.now() - startTime);
        }
        catch (e) {
            log.error('@NKUESOAddCalendarButton', e.message);
        }
    }
    function AH_ItemLeadTime_UEBeforeLoad(context) {
        try {
            const { type, form, newRecord: curRecord } = context;
            if (type === context.UserEventType.VIEW && runtime.ContextType.USER_INTERFACE === runtime.executionContext) {
                // Make extended lead times yellow
                // log.debug('@AH_ItemLeadTime_UEBeforeLoad: defaultValue', form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue);
                // log.debug('@AH_ItemLeadTime_UEBeforeLoad: typeof defaultValue', typeof form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue);
                // typeof defaultValue returns 'object' if nothing was added to the field yet
                if (typeof form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue == 'object') {
                    form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue = '';
                }
                const lineCount = curRecord.getLineCount('item');
                const lines = Array.from({ length: lineCount }, (_, i) => i).map(line => ({
                    itemtype: String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line })),
                    date: new Date(String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_lead_time', line }))),
                }));
                const dates = lines.map(line => line.date).filter(date => date.toString() !== 'Invalid Date');
                const earliestDate = new Date(dates.sort((a, b) => a.getTime() - b.getTime())[0]).toLocaleDateString();
                form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue += `
            <script>
                let iteration = 0;
                let lines = ${JSON.stringify(lines)};
                const interval = setInterval(() => {
                    const leadTimeElems = document.querySelectorAll('[data-ns-tooltip="Item Lead Time"]');
                    for (let i = 0; i < leadTimeElems.length; i++) { //color the date if it's not the earliest one.
                        iteration = 10; // Terminate after loop
                        const elem = leadTimeElems[i];
                        let curDate = elem.innerHTML;
                        if (curDate && ['Assembly', 'InvtPart'].includes(lines[i].itemtype) && new Date(curDate).toLocaleDateString() !== '${earliestDate}') {
                            elem.setAttribute('style', 'background-color: #FFFFC0 !important');
                        }
                    }
                    iteration++;
                    if (iteration > 9) { clearInterval(interval); }
                }, 500);
            </script>
        `;
                // log.debug('@AH_ItemLeadTime_UEBeforeLoad: typeof defaultValue', typeof form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue);
            }
        }
        catch (e) {
            //@ts-ignore
            log.error('@AH_ItemLeadTime_UEBeforeLoad', e.message);
        }
    }
    function clearCopiedFields(context) {
        // From Clear Copied Fields
        if (context.type === context.UserEventType.COPY) {
            // Get the current user
            const currentUser = runtime.getCurrentUser();
            // Get the role internal ID (integer)
            const roleId = currentUser.role;
            // Set Carrier to null
            context.newRecord.setValue('custbody9', null);
            // Set Tracking # to null
            context.newRecord.setValue('custbody_tracking', null);
            // Set Paid in Full to null
            context.newRecord.setValue('custbody_mb_paid_in_full', null);
            // Set CNC Shipping Paid to null
            context.newRecord.setValue('custbody10', null);
            //Set Exported to DispatchTrack to false
            context.newRecord.setValue('custbody_exported_to_dispatchtrack', false);
            // Set Manufacturing Notes to null
            // Set Build Date to null
            if (roleId == 1004 || roleId == 1009 || roleId == 1037) {
                context.newRecord.setValue('custbody_yy_so_mfgnotes', null);
                context.newRecord.setValue('custbody_yy_so_builddate', null);
            }
            // Set Large Order to false
            const custbody_mb_so_cabinets_on_order = context.newRecord.getValue('custbody_mb_so_cabinets_on_order');
            const location = context.newRecord.getValue('location');
            if (custbody_mb_so_cabinets_on_order || 0 < 100 || (location == 12 && custbody_mb_so_cabinets_on_order || 0 < 50)) {
                context.newRecord.setValue('custbody27', false);
            }
            // Set Ship Complete Updated to false
            context.newRecord.setValue('custbody38', false);
            // Set Ship Pref Changed to false
            context.newRecord.setValue('custbody_yy_so_updateshipcomplete', false);
            // Set BO Quantity to null
            context.newRecord.setValue('custbody_yy_so_backorderqty', null);
            // Set Discount Reason to null
            context.newRecord.setValue('custbody_yy_so_reason', null);
            // Set Replacement # to null
            context.newRecord.setValue('custbody_yy_so_returncount', null);
            // Set Memo to null
            context.newRecord.setValue('memo', null);
            // Set Preferred Ship Date to null
            context.newRecord.setValue('custbody_yy_so_idealshipdate', null);
            // Set Terms to Customer : Terms
            const customerId = context.newRecord.getValue('entity');
            const { terms } = search.lookupFields({
                type: search.Type.CUSTOMER,
                id: customerId,
                columns: ['terms']
            });
            if (terms && terms[0] && terms[0].value) {
                context.newRecord.setValue('terms', terms[0].value);
            }
            else {
                context.newRecord.setValue('terms', null);
            }
            // Set Truck to null
            context.newRecord.setValue('custbody_service_unit_name', null);
            // Set Ship Via to null
            if (roleId != 3529 || roleId == null) {
                context.newRecord.setValue('shipmethod', null);
            }
            // Set Stop# to null
            context.newRecord.setValue('custbody_stop_number', null);
            // Set Shipping Cost to null
            context.newRecord.setValue('shippingcost', null);
            // Set Time Window to null
            context.newRecord.setValue('custbody_time_window', null);
            // Set End Time to null
            context.newRecord.setValue('custbody_yy_endtime', null);
            // Set Original SO # to null
            context.newRecord.setValue('custbody_yy_so_replacementfor', null);
            // Set Internal CS Notes to null
            context.newRecord.setValue('custbodymb_notes_to_customer', null);
            // Set YY Notes to value in copiedfrom field if there is one, otherwise null
            const copiedFrom = context.newRecord.getValue('copiedfrom') || null;
            context.newRecord.setValue('custbody_yy_notes_tmp', copiedFrom);
            // Commented out the below code as this will happen on beforeLoad in all contexts as per 'Quote and SO Customizations' workflow functionality
            // // Set Entered By to current user
            // context.newRecord.setValue('custbody_mb_order_entered_by', currentUser.id)
            // Set Notes to Customer to null
            context.newRecord.setValue('custbody_mb_spoke_to_customer_notes', null);
            // Set eTail Channel to null
            context.newRecord.setValue('custbody_celigo_etail_channel', null);
            // Set eTail Order ID to null
            context.newRecord.setValue('custbody_celigo_etail_order_id', null);
            // Set ETAIL ORDER ACKNOWLEDGEMENT EXPORTED to false
            context.newRecord.setValue('custbody39', false);
            // Set eTail Payment Method to null
            context.newRecord.setValue('custbody_celigo_etail_origpaymentmeth', null);
            // Set Magento 2 Order Number to null
            context.newRecord.setValue('custbody_celigo_mag2_order_number', null);
            // Set Magento 2 Store to null
            context.newRecord.setValue('custbody_celigo_mag2_store', null);
            // Set Magento 2 Instance to null
            context.newRecord.setValue('custbody_celigo_mag2_instance', null);
            // Set Transfer Date to null
            context.newRecord.setValue('custbody_yy_so_xferdate', null);
            // Set Transferred to null
            context.newRecord.setValue('custbody_yy_so_transferred', null);
            // Set SO Transfer Status to null
            context.newRecord.setValue('custbody_yy_so_transferstatus', null);
            // Set Transfer To to null
            context.newRecord.setValue('custbody_yy_so_transfertowh', null);
            // Set Transfer Transaction to null
            context.newRecord.setValue('custbody_yy_so_to_xferrecord', null);
            // Set Full Quantity Built to false
            context.newRecord.setValue('custbody_mb_wo_full_qty_built', false);
            // Set No Buildable Components to null
            context.newRecord.setValue('custbody_yy_qu_notbldblcomp', null);
        }
    }
    function copiedFrom(context) {
        if (context.type === context.UserEventType.CREATE) {
            // Set custom Copied From field to value in native Copied From field
            const copiedFrom = context.newRecord.getValue('copiedfrom') || null;
            context.newRecord.setValue('custbody_yy_copiedfrom', copiedFrom);
        }
    }
    function quoteAndSOCustomizationsBeforeLoad(context) {
        if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.COPY || context.type === context.UserEventType.EDIT || context.type === context.UserEventType.XEDIT || context.type === context.UserEventType.VIEW) {
            // Get the current user
            const currentUser = runtime.getCurrentUser();
            // Get the role internal ID (integer)
            const roleId = currentUser.role;
            // Set Entered By to current user
            context.newRecord.setValue('custbody_mb_order_entered_by', roleId);
            if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.COPY) {
                // Get the created date
                const createdDate = context.newRecord.getValue({ fieldId: 'created' }); // JS Date object
                // Define comparison date
                const cutoffDate = new Date('2024-12-09');
                // Check if record was created after cutoff
                if (createdDate && createdDate > cutoffDate) {
                    // log.debug('Condition met', `Record created on ${createdDate}`);
                    // Set 5P DF to checked
                    context.newRecord.setValue('custbody_yy_so_5pdf', true);
                }
            }
        }
    }
    function FDATAUESOAssignTruckBeforeSubmit(context) {
        var rec = context.newRecord;
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT)
            return;
        const shipMethod = String(rec.getValue('shipmethod'));
        // Clear Truck #. Brought over from Sales Order Defaults workflow
        const custbody_yy_so_trucklist = rec.getValue('custbody_yy_so_trucklist');
        if (custbody_yy_so_trucklist && ![16, 97162].includes(Number(shipMethod))) {
            rec.setValue({ fieldId: "custbody_yy_so_trucklist", value: '' });
        }
        // They might make exceptions to go out to further zip codes for inside delivery (check before including CNC Inside Delivery)
        var shipMethodList = ['16']; // CNC Truck
        if (!shipMethodList.includes(shipMethod))
            return;
        var altShipMethod = 4640; // Common Carrier
        var recipient = '3';
        var author = 17644;
        let zip = String(rec.getValue('shipzip'));
        if (typeof zip == 'string') // Added the condition, not sure if neccessary - NK 10/12/2023
            zip = zip.split('-')[0]; // NKellman - Clean +4 from ZIP
        // Zip codes uploaded through CSV sometimes drop prefixed zeros. We are going to add zeros untill it equals 5 in length
        const searchZip = (zip || '').padStart(5, '0');
        if (!searchZip)
            return;
        var results = search.create({
            type: "customrecord_fd_ata_zipcode",
            filters: [["custrecord_ata_zipcode", "startswith", searchZip]],
            columns: ["custrecord_ata_zipcode", "custrecord_ata_truck"]
        }).run().getRange({ start: 0, end: 1 }).map(function (m) {
            return {
                truckid: m.getValue("custrecord_ata_truck"),
                trucknumber: m.getText("custrecord_ata_truck")
            };
        });
        if (results.length) {
            rec.setValue("custbody_yy_so_trucklist", results[0]?.truckid || '');
        }
        else {
            rec.setValue("shipmethod", altShipMethod);
            rec.setValue("altshippingcost", 0);
            rec.setValue("shippingcost", 0);
            rec.setValue('custbody_fd_ata_notification', "No truck assignment for zip code " + searchZip + " exists.\nA request for this zipcode to be added for truck assignment has been submitted");
            email.send({
                author: author,
                recipients: [recipient],
                subject: "Truck assignment request - " + searchZip,
                body: "Zipcode truck assignment request\n\n\n                   User: " + runtime.getCurrentUser().name + "\n\n                   ZipCode: " + searchZip
            });
        }
    }
    function FDACWUECheckWOCheckboxBeforeSubmit(context) {
        try {
            const { newRecord } = context;
            let custbody_nk_delay_work_orders = newRecord.getValue('custbody_nk_delay_work_orders');
            // Set Delay Work Orders to Yes if in sandbox and the value was not manually set to No.
            if (custbody_nk_delay_work_orders != 2 && runtime.envType == runtime.EnvType.SANDBOX) {
                custbody_nk_delay_work_orders = 1;
                newRecord.setValue({ fieldId: 'custbody_nk_delay_work_orders', value: custbody_nk_delay_work_orders });
            }
            // var custbody_yy_so_accountmanager = newRecord.getValue('custbody_yy_so_accountmanager');
            // Dawn was testing this feature but asked to delay it on 2/6 until we look into some back order information on her delayed work orders.
            if (custbody_nk_delay_work_orders == 1) {
                const lineCount = newRecord.getLineCount({ sublistId: 'item' });
                Array.from({ length: lineCount }, (_, i) => i).map(line => {
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'createwo', value: false, line });
                });
                return;
            }
            else {
                const lineCount = newRecord.getLineCount({ sublistId: 'item' });
                Array.from({ length: lineCount }, (_, i) => i).map(line => {
                    const itemtype = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line });
                    if (itemtype == 'Assembly') {
                        newRecord.setSublistValue({ sublistId: 'item', fieldId: 'createwo', value: true, line });
                    }
                });
                return;
            }
        }
        catch (e) {
            log.error('@FDACWUECheckWOCheckboxBeforeSubmit', e.message);
        }
    }
    function getPriceLevelMap(priceLevels) {
        if (R.isEmpty(priceLevels))
            return {};
        return search.create({
            type: "pricelevel",
            filters: [
                ["isinactive", "is", "F"], "AND",
                ["internalid", "anyof", priceLevels]
            ],
            columns: ['name']
        }).run().getRange({ start: 0, end: 1000 }).reduce(function (pre, cur) {
            return Object.assign(pre, { [cur.id]: cur.getValue('name') });
        }, {});
    } // Support function for FDTLSUETransformAccessoriesForCSV
    function setAccessoryPriceLevels(rec) {
        var itemsWithoutPriceLevelText = R.range(0, rec.getLineCount('item'))
            .map(function (line) {
            var pricelevel = Number(rec.getSublistValue({ sublistId: 'item', fieldId: 'price', line: line }));
            return {
                line: line,
                itemid: rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line }),
                group: rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_fd_tls_item_group', line: line }),
                collection: rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: line }),
                pricelevel: pricelevel,
                woid: rec.getSublistValue({ sublistId: 'item', fieldId: 'woid', line: line }),
                quantityfulfilled: rec.getSublistValue({ sublistId: 'item', fieldId: 'quantityfulfilled', line: line }) || 0,
                quantity: Number(rec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: line })),
            };
        });
        var RTA = 1;
        var ACCESSORY = 2;
        var BASE_PRICE = 1;
        var REV = 17;
        // const accessories = items.filter((f) => f.group === 'ACCESSORY' && f.pricelevelText === 'Base Price')
        var accessories = itemsWithoutPriceLevelText.filter(function (f) { return (f.group == ACCESSORY || f.collection == REV) && f.pricelevel == BASE_PRICE; });
        if (R.isEmpty(accessories))
            return;
        var priceLevels = R.map(R.prop('pricelevel'), itemsWithoutPriceLevelText);
        var priceLevelMap = getPriceLevelMap(priceLevels);
        var items = itemsWithoutPriceLevelText.map(function (lineitem) { return (Object.assign(Object.assign({}, lineitem), { pricelevelText: priceLevelMap[lineitem.pricelevel] })); });
        var cabinets = items
            .filter(function (f) { return f.group == RTA && !isNaN(Number(f.pricelevelText)); })
            .sort(function (a, b) { return Number(a.pricelevelText) - Number(b.pricelevelText); });
        var pl = R.pathOr('', ['pricelevelText'], R.last(cabinets)).toString();
        if (!pl) {
            try {
                // Need to set REV items to 2500 price level when there are no RTA
                // lines on order (as per Robert's email)
                let revItems = accessories.filter(function (item) { return item.collection == 17; });
                if (R.isEmpty(revItems))
                    return;
                var pricingSearch = search.create({
                    type: search.Type.ITEM,
                    filters: [
                        ["internalid", "anyof", [...new Set(accessories.map(accessory => accessory.itemid))]], "AND",
                        ["pricing.internalid", "anyof", 19]
                    ],
                    columns: [
                        search.createColumn({ name: "pricelevel", join: "pricing" }),
                        search.createColumn({ name: "internalid", join: "pricing" }),
                        search.createColumn({ name: "item", join: "pricing" }),
                        search.createColumn({ name: "iteminternalid", join: "pricing" }),
                        search.createColumn({ name: "unitprice", join: "pricing" })
                    ]
                }).run().getRange({ start: 0, end: 1000 }).map(function (m) {
                    return ({
                        priceleveltext: m.getText({ name: "pricelevel", join: "pricing" }),
                        pricelevel: m.getValue({ name: "pricelevel", join: "pricing" }),
                        itemid: m.getValue({ name: "iteminternalid", join: "pricing" }),
                        rate: m.getValue({ name: "unitprice", join: "pricing" }),
                    });
                });
                var revItemsAndPricing = R.groupBy(R.prop('itemid'), pricingSearch);
                revItems.forEach(function (revItem) {
                    var price = R.pathOr(null, [revItem.itemid, 0])(revItemsAndPricing);
                    rec.setSublistValue({ sublistId: 'item', fieldId: 'price', line: revItem.line, value: 19 });
                    // nlapiSetLineItemValue('item', 'price_display', f.line, pl);
                    rec.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: revItem.line, value: price.rate });
                    rec.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: revItem.line, value: price.rate * revItem.quantity });
                });
            }
            catch (e) {
                //@ts-ignore
                log.error('@setAccessoryPriceLevels', e.message);
            }
            return;
        }
        var plVal = R.pathOr('1', ['pricelevel'], R.last(cabinets)).toString();
        var pricingSearch = search.create({
            type: search.Type.ITEM,
            filters: [
                ["internalid", "anyof", R.uniq(R.map(R.prop('itemid'), accessories))], "AND",
                ["pricing.internalid", "anyof", plVal]
            ],
            columns: [
                search.createColumn({ name: "pricelevel", join: "pricing" }),
                search.createColumn({ name: "internalid", join: "pricing" }),
                search.createColumn({ name: "item", join: "pricing" }),
                search.createColumn({ name: "iteminternalid", join: "pricing" }),
                search.createColumn({ name: "unitprice", join: "pricing" })
            ]
        }).run().getRange({ start: 0, end: 1000 }).map(function (m) {
            return ({
                priceleveltext: m.getText({ name: "pricelevel", join: "pricing" }),
                pricelevel: m.getValue({ name: "pricelevel", join: "pricing" }),
                itemid: m.getValue({ name: "iteminternalid", join: "pricing" }),
                rate: m.getValue({ name: "unitprice", join: "pricing" }),
            });
        });
        var accessoriesAndPricing = R.groupBy(R.prop('itemid'), pricingSearch);
        accessories.forEach(function (f) {
            var price = R.pathOr(null, [f.itemid, 0])(accessoriesAndPricing);
            rec.setSublistValue({ sublistId: 'item', fieldId: 'price', line: f.line, value: plVal });
            if (price) {
                rec.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: f.line, value: price.rate });
                rec.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: f.line, value: price.rate * f.quantity });
            }
        });
    } // Support function for FDTLSUETransformAccessoriesForCSV
    function FDTLSUETransformAccessoriesForCSV(context) {
        var newRecord = context.newRecord;
        setAccessoryPriceLevels(newRecord);
    }
    function getDiscountedLines(options) {
        var duration = new Date().getTime();
        var { newRecord: rec, id, exclude, group } = options;
        if (!rec && id)
            rec = record.load({ type: record.Type.SALES_ORDER, id });
        var discountedLines = [];
        var discounts = {
            global: [],
            subtotal: [],
            line: []
        };
        // Check if discount was applied through checkbox or lines?
        var discountrate = Number(rec.getValue({ fieldId: 'discountrate' }));
        if (discountrate) {
            discounts.global.push(discountrate);
        }
        // Check if any discounts were applied through the promotions sublist
        var promoNumLines = rec.getLineCount({ sublistId: 'promotions' });
        for (var line = 0; line < promoNumLines; line++) {
            var promotionDiscount = parseFloat(rec.getSublistValue({
                sublistId: 'promotions',
                fieldId: 'discountrate',
                line
            })) || 0;
            if (promotionDiscount) {
                discounts.global.push(promotionDiscount);
            }
        }
        var numLines = rec.getLineCount({ sublistId: 'item' });
        for (var line = numLines - 1; line > -1; line--) {
            // Needs to check for more than one item_display for discount and subtotal so using itemtype
            var itemtype = rec.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line });
            if (itemtype == 'Subtotal') {
                // If a discount line is added directly below a subtotal line the discount will apply to every item included in the subtotal
                discounts.subtotal = discounts.line;
                discounts.line = [];
            }
            else if (itemtype == 'Discount') {
                // When there are consecutive discount lines they will both apply to the previous item or subtotal.
                // This leads to discounts that apply to items/subtotals that are more than one line above them.
                // These will also compound if there are multiple in a row
                var discount = rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line });
                if (discount != exclude) {
                    discounts.line.push(rec.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'rate',
                        line
                    }));
                }
            }
            else if (!['Discount', 'Subtotal', 'Maritime Fee'].includes(itemtype)) {
                var lineApplicableDiscounts = discounts.global.concat(discounts.subtotal).concat(discounts.line);
                if (lineApplicableDiscounts.length) {
                    // Clear the line specific discounts as they only apply to this line (this does not affect the array that is referenced by lineApplicableDiscounts)
                    discounts.line = [];
                    let lineRate = lineApplicableDiscounts.reduce((acc, val) => acc + val);
                    var initialPrice = Number(rec.getSublistValue({ sublistId: 'item', fieldId: 'amount', line }));
                    var discountAmount = (initialPrice * (lineRate / 100) || 0) * -1;
                    // var adjustedPrice = (initialPrice + discountAmount).toFixed(2);
                    discountedLines.unshift({
                        discountAmount: Number(discountAmount.toFixed(2)),
                        discountRate: lineRate,
                        discountsApplied: lineApplicableDiscounts,
                        line
                    });
                }
            }
        }
        duration = new Date().getTime() - duration;
        /*  if (duration > 9) {
             log.debug('@getDiscountedLines: duration', duration);
         } */
        // I commented out because it didn't look like it was doing anything
        /* if (group == '1') {
            var discountedItems = discountedLines.reduce(items, line => {
    
            }, discountedLines);
            return discountedItems;
        }
        if (group == '2') {
            var discountedItems = discountedLines.reduce(items, line => {
    
            }, discountedLines);
            return discountedItems;
        } */
        return discountedLines;
    } // Support function for FDABDBulkDiscount
    function FDABDBulkDiscount(context) {
        try {
            var { newRecord, type, UserEventType } = context;
            if (type !== UserEventType.CREATE &&
                type !== UserEventType.EDIT &&
                type !== UserEventType.COPY &&
                type !== UserEventType.TRANSFORM)
                return;
            var datecreated = new Date(String(newRecord.getValue('createddate'))) || new Date();
            if (datecreated.getTime() < new Date('5/14/2024').getTime())
                return;
            var status = newRecord.getValue('status');
            if (status === 'Cancelled' || status === 'Closed' || status === 'Billed')
                return;
            // As per Jennifer INT is excluded from these discounts
            var entity = newRecord.getValue('entity');
            if (entity == '5733')
                return;
            // Edge case of discountrate field storing a dollar amount can be ignored (orders with those discounts will be excluded later "if (discountrate <= -20)")
            var discountrate = Number(newRecord.getValue('discountrate'));
            // Cannot use getText due to orders created via CSV (interestingly enough can use SS 1.0 as it does record the type of discount in nlapiGetValue)
            // var discounttotal = Number(newRecord.getValue('discounttotal'));
            // var discounttype;
            // try {
            //     discounttype = newRecord.getText('discountrate').includes('%') && '%' || '$';
            // } catch (e) { log.error(`@FDABDBulkDiscount: ${tranid} getText`, e.message); }
            var tranid = newRecord.getValue('tranid');
            if (discountrate <= -20) {
                //log.debug(`@FDABDBulkDiscount: ${tranid} already discounted`, discountrate)
                return;
            }
            else if (discountrate > 0) {
                discountrate = 0;
            }
            var lineCount = newRecord.getLineCount('item');
            if (!lineCount)
                return;
            var discount = '140387';
            var otherDiscounts = getDiscountedLines({ newRecord, exclude: discount });
            //if (otherDiscounts.length) { log.debug('@FDABDBulkDiscount: Discount Lines', otherDiscounts); }
            var lines = Array.from({ length: lineCount }, (v, i) => i).map(line => ({
                itemid: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line }),
                item_display: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item_display', line: line }),
                itemtype: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: line }),
                amount: Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line })),
                price: String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'price', line: line })),
                discountrate: otherDiscounts.find(item => item.line == line)?.discountRate,
                discountamount: Number(otherDiscounts.find(item => item.line == line)?.discountAmount),
                quantity: Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: line })),
                line: line
            }));
            // If there are less than 50 items on order (so we can avoid the search upcoming)
            if (lines.reduce((total, line) => total + (line.quantity || 0), 0) < 50) {
                return;
            }
            // item_display field value is empty on CSV imports
            // Get the name via a search
            if (lines.some(item => !item.item_display)) {
                var searchStartTime = new Date().getTime();
                var itemids = lines.map(item => item.itemid);
                var names = search.create({
                    type: 'item',
                    filters: ['internalid', 'anyof', itemids],
                    columns: ['name']
                }).run().getRange({ start: 0, end: 1000 }).reduce((names, result) => {
                    names[result.id] = result.getValue('name');
                    return names;
                }, {});
                var searchDuration = new Date().getTime() - searchStartTime;
                lines.forEach(line => line.item_display = names[String(line.itemid)]);
            }
            // Merge lines based on the second part of the SKU (delimited by "-")
            let items = lines.reduce((acc, line) => {
                var group = String(line.item_display)?.split('-')[1];
                var item = acc.find(item => item.group == group);
                if (item) {
                    item.quantity += line.quantity;
                    item.amount += line.amount;
                    item.discountamount += line.discountamount;
                    item.lines.push(line.line);
                    item.prices.push(line.price);
                }
                else {
                    item = Object.assign(line, {
                        group,
                        lines: [line.line],
                        prices: [line.price]
                    });
                    acc.push(item);
                }
                return acc;
            }, []);
            items = items.map(item => Object.assign(item, { discountedrate: 1 - (item.discountamount / item.amount) }));
            // log.debug('@FDABDBulkDiscount: items', items);
            var discountableItems = items.filter(item => item.quantity >= 50 && item.prices.length && !item.prices.includes('1') && ['TKS', 'ICM', 'OCM', 'SHM', 'SCM'].includes(item.group));
            if (!discountableItems.length)
                return;
            if (type !== UserEventType.CREATE && runtime.envType != runtime.EnvType.SANDBOX)
                return;
            // Partially hard coded
            var { parent, custentity_nk_bulk_moldings_discounted } = search.lookupFields({ type: search.Type.CUSTOMER, id: entity, columns: ['parent', 'custentity_nk_bulk_moldings_discounted'] });
            if (!custentity_nk_bulk_moldings_discounted || parent && parent[0] && parent[0].value == '18662') {
                return;
            }
            var prediscount = discountableItems.reduce((a, v) => a + v.amount, 0);
            var discounted = discountableItems.reduce((a, v) => a + v.discountamount || 0, 0);
            // Avoids div by 0
            if (!prediscount) {
                return;
            }
            var subtractDiscounts = discounted / prediscount;
            if (subtractDiscounts > 0.2) {
                return;
            }
            var bulkDiscountRate = 0.2 - subtractDiscounts;
            var discountLine = newRecord.findSublistLineWithValue({ sublistId: 'item', fieldId: 'item', value: discount });
            if (discountLine == -1) {
                discountableItems.sort((a, b) => Math.max(...b.lines) - Math.max(...a.lines));
                discountLine = Math.max(...discountableItems[0].lines) + 1;
                newRecord.insertLine({ sublistId: 'item', line: discountLine });
            }
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', value: discount, line: discountLine });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'price', value: -1, line: discountLine });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', value: prediscount * bulkDiscountRate * -1, line: discountLine });
        }
        catch (e) {
            //@ts-ignore
            log.error('@FDABDBulkDiscount', e.message);
        }
    }
    function getItemLines(rec) {
        var lineCount = rec.getLineCount('item');
        var location = rec.getValue({ fieldId: 'location' });
        var xferdate = rec.getValue('custbody_yy_so_xferdate');
        var custbody_yy_qu_transfercheck = rec.getValue('custbody_yy_qu_transfercheck');
        var alwaysBuildableItems = [82755];
        return Array.from({ length: lineCount }, (v, i) => i).map(function (line) {
            var item = rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line });
            var override = alwaysBuildableItems.includes(Number(item));
            var isMilanoOrBroadway = false;
            if (!override && (location == 7 || xferdate || custbody_yy_qu_transfercheck)) {
                try {
                    var collection = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: line });
                    var isConOrCls = collection == 1 || collection == 2;
                    if (isConOrCls) {
                        var fields = search.lookupFields({ type: search.Type.ITEM, id: item, columns: ['custitem_mb_item_item_type', 'custitem_mb_item_style', 'custitem_er_collection_group'] });
                        var custitem_mb_item_item_type = fields.custitem_mb_item_item_type?.[0].value;
                        var custitem_mb_item_style = fields.custitem_mb_item_style?.[0].value;
                        var custitem_er_collection_group = fields.custitem_er_collection_group?.[0].value;
                        isMilanoOrBroadway = [1, 2, 3, 4, 7, 8].includes(parseInt(custitem_er_collection_group));
                        var isHood = '14' == custitem_mb_item_item_type;
                        var isSampleDoor = '17' == custitem_mb_item_item_type;
                        var isAccessory = '8' == custitem_mb_item_item_type;
                        var isParkAve = '4' == custitem_mb_item_style || '29' == custitem_mb_item_style;
                        ;
                        if (!isHood && !isSampleDoor && !isAccessory && !isParkAve) {
                            override = true;
                        }
                    }
                }
                catch (e) {
                    //@ts-ignore
                    log.error('@getItemLines > @search.lookupFields', e.message);
                }
            }
            return {
                name: String(rec.getSublistValue({ sublistId: 'item', fieldId: 'item_display', line: line })),
                itemid: String(rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line })),
                quantity: Number(rec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: line })),
                type: String(rec.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: line })),
                collection: String(rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: line })),
                custcol_fd_tls_item_group: String(rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_fd_tls_item_group', line: line })),
                isMilanoOrBroadway,
                override,
                line
            };
        });
    } // Support function for FDMQBUE
    function FDMQBUE(context) {
        try {
            var { newRecord } = context;
            var rec = newRecord;
            if (rec.type !== record.Type.SALES_ORDER && rec.type !== record.Type.ESTIMATE)
                return;
            var isSkipMqbCalculation = rec.getValue('custbody_mqb_skip_calculation');
            if (isSkipMqbCalculation) {
                return;
            }
            if (context.type !== context.UserEventType.EDIT && context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.COPY && context.type !== context.UserEventType.APPROVE)
                return;
            var tranid = rec.getValue('tranid');
            var subsidiaryId = rec.getValue('subsidiary');
            var locationId = rec.getValue('location');
            var xferdate = rec.getValue('custbody_yy_so_xferdate');
            var custbody_yy_qu_transfercheck = rec.getValue('custbody_yy_qu_transfercheck');
            if (xferdate || custbody_yy_qu_transfercheck) {
                locationId = '7';
            }
            var entity = rec.getValue('entity');
            var isLargeOrder = rec.getValue('custbody27');
            var custbody_yy_so_replacement = rec.getValue('custbody_yy_so_replacement');
            var custbody_yy_nfp = !!rec.getValue('custbody_yy_nfp');
            var custbody_yy_so_manualnfp = rec.getValue('custbody_yy_so_manualnfp');
            var trandate = rec.getValue('trandate');
            var entityText;
            var defaultWarehouse;
            var orderstatus = rec.getValue('orderstatus');
            var unapproved = context.type == context.UserEventType.APPROVE || orderstatus == 'A';
            var comeAgain;
            try {
                var results = search.lookupFields({ type: 'customer', id: entity, columns: ['entityid', 'custentitymb_warehouse_location'] });
                entityText = results && results.entityid;
                defaultWarehouse = results && results.custentitymb_warehouse_location && results.custentitymb_warehouse_location[0] && results.custentitymb_warehouse_location[0].value;
            }
            catch (e) {
                //@ts-ignore
                log.error('@FDMQBUE > @search.lookupFields: ', e.message);
            }
            if (custbody_yy_so_manualnfp) {
                custbody_yy_nfp = !!rec.getValue({ fieldId: 'custbody_yy_nfp' });
            }
            else if (custbody_yy_so_replacement) {
                try {
                    custbody_yy_nfp = !!search.lookupFields({ type: search.Type.TRANSACTION, id: custbody_yy_so_replacement, columns: 'custbody_yy_nfp' })?.custbody_yy_nfp;
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: custbody_yy_nfp });
                }
                catch (e) {
                    //@ts-ignore
                    log.error('@FDMQBUE > @search.lookupFields', e.message);
                }
            }
            else if (entityText.substring(0, 3) == 'LPS') {
                if ([
                    'LPS : LPS-MIN',
                    'LPS : LPS-ATL',
                    'LPS : LPS-CHAR',
                    'LPS : LPS-DAL',
                    'LPS : LPS-DEN',
                    'LPS : LPS-HOU',
                    'LPS : LPS-LA',
                    'LPS : LPS-LAC',
                    'LPS : LPS-LAS',
                    'LPS : LPS-MIA',
                    'LPS : LPS-NORF',
                    'LPS : LPS-ORL',
                    'LPS : LPS-PHO',
                    'LPS : LPS-RAL',
                    'LPS : LPS-RICH',
                    'LPS : LPS-SAC',
                    'LPS : LPS-SAN',
                    'LPS : LPS-SAND',
                    'LPS : LPS-SANFRAN',
                    'LPS : LPS-SANTA',
                    'LPS : LPS-SEA',
                    'LPS : LPS-TAMPA',
                    'LPS : LPS-NASH'
                ].includes(entityText)) {
                    custbody_yy_nfp = true;
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: true });
                }
                else {
                    custbody_yy_nfp = false;
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: false });
                }
            }
            else if (new Date(String(trandate)).getTime() >= new Date('6/15/2025').getTime()) {
                custbody_yy_nfp = true;
                rec.setValue({ fieldId: 'custbody_yy_nfp', value: custbody_yy_nfp });
            }
            else if (entityText.substring(0, 4) == 'PARR' && new Date(String(trandate)).getTime() >= new Date('1/9/2024').getTime()) {
                custbody_yy_nfp = true;
                rec.setValue({ fieldId: 'custbody_yy_nfp', value: true });
            }
            else if (['KBCREATION', 'OK'].includes(entityText) && new Date(String(trandate)).getTime() >= new Date('1/1/2025').getTime()) {
                custbody_yy_nfp = true;
                rec.setValue({ fieldId: 'custbody_yy_nfp', value: true });
            }
            else if (locationId != '7' && new Date(String(trandate)).getTime() >= new Date('4/12/2024').getTime()) {
                custbody_yy_nfp = true;
                rec.setValue({ fieldId: 'custbody_yy_nfp', value: custbody_yy_nfp });
            }
            else if (locationId == '7') {
                if (defaultWarehouse != '7' && new Date(String(trandate)).getTime() >= new Date('2/9/2025').getTime()) {
                    // This should not run the opposite way, meaning that if a customer with NJ as the default warehouse should still get NFP for orders with a different location
                    custbody_yy_nfp = true;
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: true });
                }
                else {
                    if (!['PANE', 'BONDP', 'MANS', 'NHF', 'NY', 'KURT', 'BCAB'].includes(entityText) && !['NHF :'].includes((entityText || '').slice(0, 5)) && !['BCAB :'].includes((entityText || '').slice(0, 6))) {
                        comeAgain = true;
                    }
                    custbody_yy_nfp = false;
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: false });
                    // We still want to pass FP to the MQB function so we get both FP and NFP BOMs
                }
            }
            var bestBoms = [];
            var allBoms = [];
            var itemsLines = getItemLines(rec).filter(item => ['Assembly', 'InvtPart'].includes(String(item.type)));
            var buildables = cnc_functions.maxQtyBuildable_nk_mqb_util({ itemsLines, subsidiaryId, locationId, isLargeOrder, entityText, custbody_yy_nfp, detailed: true });
            itemsLines.reduce(function (itemBomLookupObj, _a) {
                var { itemid, type: itemtype, quantity, line, name, isMilanoOrBroadway } = _a;
                var allItemBoms = itemBomLookupObj[itemid] && itemBomLookupObj[itemid].boms || itemBomLookupObj[itemid] || [];
                _a.name ||= itemBomLookupObj[itemid] && itemBomLookupObj[itemid].name;
                if (!_a.name) {
                    log.error(`@FDMQBUE: ${rec.getValue('tranid')}`, 'Item name undefined');
                }
                if (isMilanoOrBroadway && ['OCM', 'SCM', 'SHM', 'ICM'].some(section => (String(name) || '').includes(String(section)))) {
                    _a.override = false;
                }
                allBoms = allBoms.concat(allItemBoms);
                var bestBom = cnc_functions.getBestBom_nk_mqb_util({ quantity, boms: allItemBoms });
                bestBoms.push(bestBom);
                var bestBomId = bestBom && bestBom.id || '';
                var bestBomBuildableQty = bestBom && bestBom.mqb || 0; // bbbq
                var isBuildable = Math.floor(bestBomBuildableQty - Number(quantity || 0)) >= 0;
                // Inventory items don't have BOMs and their availability depends on the item itself
                if (itemtype == 'InvtPart') {
                    isBuildable = Number(itemBomLookupObj[itemid].available) > Number(quantity || 0);
                    itemBomLookupObj[itemid].available = String(Number(itemBomLookupObj[itemid].available) - Number(quantity || 0));
                }
                // As per Yitz Younger and Ellie Drew 7/19/2023
                // Most items that are part of the CONCORD collections are not considered backordered (in NJ) as far as customer service is concerned.
                // In the event that manufacturing sees no way
                // of building the items they will notify cutomer service manually
                var override = _a.override;
                var bestBomIndex = allItemBoms.findIndex(bom => bom.id == bestBomId);
                rec.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_mb_buildable',
                    value: override || isBuildable,
                    line: line
                });
                rec.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_nk_has_buildable_bom',
                    value: isBuildable,
                    line: line
                });
                rec.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_fd_mqb_bom_id',
                    value: bestBomId,
                    line: line
                });
                // Update buildable quantity in case there are still more of that item on the sales order
                if (isBuildable && itemtype !== 'InvtPart') {
                    (itemBomLookupObj[itemid] && itemBomLookupObj[itemid].boms || itemBomLookupObj[itemid])[bestBomIndex].mqb -= Number(quantity || 0);
                }
                return itemBomLookupObj;
            }, buildables);
            // Loop over the lines one more time and mark them buildable if the work order is buildable
            var woids = [];
            for (var line = 0; line < newRecord.getLineCount('item'); line++) {
                var custcol_mb_buildable = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_buildable', line });
                var woid = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'woid', line }));
                if (woid && !custcol_mb_buildable) {
                    woids.push(woid);
                }
            }
            try {
                if (woids.length) {
                    var queryStartTime = Date.now();
                    var workOrderBuildableLookup = query.runSuiteQL({
                        query: `
              SELECT
                id as woid,
                custbody_mb_wo_is_buildable as buildable
              FROM
                transaction
              WHERE
                transaction.id IN ('${woids.join("', '")}')
            `
                    }).asMappedResults().reduce((lookup, { woid, buildable }) => { lookup[String(woid)] = buildable; return lookup; }, {});
                    for (var line = 0; line < newRecord.getLineCount('item'); line++) {
                        var woid = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'woid', line }));
                        if (workOrderBuildableLookup[woid] == 'T') {
                            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_buildable', line, value: true });
                        }
                    }
                }
            }
            catch (e) {
                //@ts-ignore
                log.error('@FDMQBUE > @workOrderBuildableLookup', e.message);
            }
            if (unapproved && comeAgain && allBoms.some(bom => bom.fpBom)) {
                if (bestBoms.every(bom => bom.fpBom == false)) {
                    custbody_yy_nfp = true;
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: true });
                }
                else {
                    //log.debug(`@FDMQBUE: [FP order with FP BOMs (${tranid})]`, bestBoms.filter(bom => bom.fpBom));
                }
            }
            if (unapproved && custbody_yy_nfp && !custbody_yy_so_replacement) {
                var hasAnyBuildableFpBom;
                try {
                    var allFpBoms = Object.values(buildables).flatMap(bomDetails => bomDetails.fpBoms);
                    hasAnyBuildableFpBom = allFpBoms.some(bom => !bom.linesBackordered);
                    if (!['KBCREATION', 'OK', 'PANE', 'CAMP', 'BONDP', 'MANS', 'NHF', 'NY', 'KURT', 'LPS', 'BCAB', 'CAMPBELL', 'STINE-SULPHUR', 'SLAND', '2NDS', 'HHC-SINGLE'].includes(entityText)
                        && !['LPS :'].includes((entityText || '').slice(0, 5))
                        && !['NHF :'].includes((entityText || '').slice(0, 5))
                        && !['BCAB :'].includes((entityText || '').slice(0, 6))
                        && !['SLAND :'].includes((entityText || '').slice(0, 7))
                        && !['HHC-SINGLE :'].includes((entityText || '').slice(0, 12))
                        && !['STINE-SULPHUR :'].includes((entityText || '').slice(0, 15))) {
                        if (hasAnyBuildableFpBom) {
                            var vanities = search.create({
                                type: search.Type.ITEM,
                                filters: [
                                    ['internalid', 'anyof', itemsLines.map(({ itemid }) => itemid)], 'AND',
                                    ['custitem_mb_item_item_type', 'anyof', '7']
                                ],
                                columns: ['custitem_mb_item_item_type']
                            }).run().getRange({ start: 0, end: 1000 }).map(result => result.id);
                            // Should check if the bug is a feature and the functionality is not wanted anymore
                            // @ts-ignore 
                            if (vanities.length && vanities.every(vanity => buildables[vanity] && buildables[vanity].fpBoms && buildables[vanity].fpBoms.some(bom => !bom.linesBackordered && bom.mqb > itemsLines.filter(line => line.item == vanity).reduce((sum, line) => sum += Number(line.quantity || 0), 0)))) {
                                rec.setValue({ fieldId: 'custbody_nk_fp_vanities', value: true });
                            }
                        }
                    }
                }
                catch (e) {
                    //@ts-ignore
                    log.error('@FDMQBUE > @set hasAnyBuildableFpBom', e.message);
                }
            }
        }
        catch (e) {
            //@ts-ignore
            log.error(`@FDMQBUE: ${tranid}`, e.message);
        }
    }
    function setShippingCost(context) {
        var { newRecord } = context;
        // Keeping the record variable name "currentRecord"
        // so that it is consistent with the client script
        var currentRecord = newRecord;
        var override = currentRecord.getValue('custbody_mb_gas_charge_override');
        if (override) {
            return true;
        }
        var entity = currentRecord.getValue('entity');
        if (entity == '921') {
            // As per Yosef he will set the ship cost for this customer manually
            return true;
        }
        var subtotal = Number(currentRecord.getValue('subtotal') || 0);
        var shipmethod = currentRecord.getValue('shipmethod');
        var freightIncluded = currentRecord.getValue('custbody16');
        var discountitem = currentRecord.getValue('discountitem');
        // For testing when this errors in xedit
        /*
        if (runtime.getCurrentUser().id == 94242) {
            email.send({
                author: '94242',
                recipients: 94242,
                subject: 'currentRecord',
                body: JSON.stringify(currentRecord)
            });
            log.debug('@setShippingCost: currentRecord.getValue', currentRecord.getValue);
            log.debug('@setShippingCost: tranid', currentRecord.getValue('tranid'));
            log.debug('@setShippingCost: entity', entity);
        }
        */
        if (!entity) {
            // Likely xedit which we may need to cover for (unless you can't xedit shipcost) but leaving it for now
            return;
        }
        if (subtotal <= 0 || freightIncluded || discountitem == '67258' || ['80326', '62060', '68503'].includes(String(shipmethod))) {
            var shippingcost = Number(currentRecord.getValue('shippingcost') || 0);
            if (!shippingcost)
                return true;
            var tranid = currentRecord.getValue('tranid');
            var reason = '';
            if (freightIncluded) {
                reason = 'Freight Included';
                // currentRecord.setValue({fieldId: 'shippingcost', value: 0});
            }
            else if (['80326', '62060', '68503'].includes(String(shipmethod))) {
                reason = 'Pickup';
                // currentRecord.setValue({fieldId: 'shippingcost', value: 0});
            }
            else if (subtotal <= 0) {
                reason = 'Subtotal 0';
                // currentRecord.setValue({fieldId: 'shippingcost', value: 0});
            }
            currentRecord.setValue({ fieldId: 'shippingcost', value: 0 });
            return true;
        }
        var cubicfeet = 0;
        var assembled;
        var maritime = 0;
        var tariffs = 0;
        // Subtotal field is not updated with the changes in countertop price at this point so calculating manually
        var calculated = 0;
        var lineCount = currentRecord.getLineCount({ sublistId: 'item' });
        for (var line = 0; line < lineCount; line++) {
            var item = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line });
            var quantity = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: line }) || 0);
            var itemtype = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: line });
            if (itemtype != 'Subtotal') {
                calculated += Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line }));
            }
            var columns = ['custitem_mb_cubicfeet'];
            if (!assembled) {
                columns = columns.concat(['custitem_mb_item_group', 'custitem_mb_item_assembled']);
            }
            var { custitem_mb_cubicfeet, custitem_mb_item_group, custitem_mb_item_assembled } = search.lookupFields({ type: search.Type.ITEM, id: item, columns });
            var lineCubicfeet = Number(custitem_mb_cubicfeet) || 0;
            var lineAssembled = custitem_mb_item_assembled && custitem_mb_item_assembled[0] && custitem_mb_item_assembled[0].value;
            var group = custitem_mb_item_group && custitem_mb_item_group[0] && custitem_mb_item_group[0].value;
            /*  if (entity == '39390') {
                 log.debug('@setShippingCost: [lineAssembled, group]', [lineAssembled, group]);
             } */
            cubicfeet += quantity * lineCubicfeet;
            if (group == 1 && lineAssembled == 1 && !assembled) {
                assembled = true;
            }
            if (item == '91214') {
                maritime = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line }));
            }
            if (item == '307591') {
                try {
                    var createddate = currentRecord.getValue('createddate') || currentRecord.getValue('datecreated');
                    /* if (context.type == context.UserEventType.CREATE || runtime.getCurrentUser().id == 94242) {
                        log.debug("@setShippingCost: -new Date('6/17/2025, 1:00 PM') - 10800000-", new Date('6/17/2025, 1:00 PM').getTime() - 10800000);
                        log.debug('@setShippingCost: -new Date(createddate)-', new Date('6/17/2025, 12:50:00 PM').getTime());
                        log.debug("@setShippingCost: -new Date(createddate) >= new Date('6/17/2025, 12:50:00 PM') - 10800000-", new Date(String(createddate)).getTime() >= new Date('6/17/2025, 1:00 PM').getTime() - 10800000);
                    } */
                    if (new Date(String(createddate)).getTime() >= new Date('6/17/2025, 1:00 PM').getTime() - 10800000) {
                        tariffs += Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line }) || 0);
                    }
                }
                catch (e) {
                    //@ts-ignore
                    log.error('@setShippingCost', e.message);
                }
            }
        }
        // log.debug('@setShippingCost: calculated', calculated);
        // Hopefully the calculated shipping total does not get messed up if there are discount and markup lines
        /* if (subtotal != parseFloat(calculated.toFixed(2))) {
            log.audit('@setShippingCost: Subtotal Diff ' + newRecord.getValue('tranid'), `subtotal: ${subtotal} | calculated: ${calculated}`);
        } */
        var discounttotal = currentRecord.getValue('discounttotal');
        var shipping = 0;
        var createdfrom = currentRecord.getValue('createdfrom');
        // One of the confusing things about migrating a workflow to a script
        // is that later workflow actions need to come first in if else statements
        // as they override previous workflow actions
        cubicfeet = Math.floor(cubicfeet / 500) - 1;
        // CNC TRUCK
        if (['97162', '16', '119413'].includes(String(shipmethod))) {
            // ALWA Does not pay shipping for orders less than $1000
            // (Hardcoding this is terrible but I don't want to add a field to the customer record for just one customer,
            // the other alternative is to make a new record to store this info and link it to the customer)
            subtotal = Number(subtotal) || 0;
            if (String(entity) === '3781' && subtotal < 1000) {
                return;
            }
            var { custentity_mb_markup } = search.lookupFields({ type: search.Type.ENTITY, id: entity, columns: ['custentity_mb_markup'] });
            var markup = Number(String(custentity_mb_markup).replace('%', '') || 0) / 100;
            if (!markup) {
                var shippingcost = Number(currentRecord.getValue('shippingcost') || 0);
                if (shippingcost) {
                    var tranid = currentRecord.getValue('tranid');
                    currentRecord.setValue({ fieldId: 'shippingcost', value: 0 });
                }
                return true;
            }
            if (cubicfeet > 0) {
                shipping = cubicfeet * 500;
                currentRecord.setValue({ fieldId: 'shippingcost', value: shipping });
            }
            else {
                var gasfee = Number(currentRecord.getValue('custbody_yy_so_gasfee')) / 100;
                shipping = (calculated - maritime - tariffs) * gasfee;
                var trandate = new Date(String(currentRecord.getValue('trandate'))).getTime();
                var transitionDate = new Date('2/21/2022').getTime();
                var locationRec = currentRecord.getValue('location');
                var transferLocationRec = currentRecord.getValue('custbody_yy_so_transfertowh');
                var transferLocationMinimum;
                if (transferLocationRec) {
                    transferLocationMinimum = search.lookupFields({ type: search.Type.LOCATION, id: transferLocationRec, columns: ['custrecord_yy_shippingminimum'] }).custrecord_yy_shippingminimum;
                }
                var locationMinimum = search.lookupFields({ type: search.Type.LOCATION, id: locationRec, columns: ['custrecord_yy_shippingminimum'] }).custrecord_yy_shippingminimum;
                ;
                // We want to differentiate between '' and 0 here. (That's how it was written in the original workflow)
                // THIS IS A SOMEWHAT BUGGY BEHAVIOR, however, the intention of the script today is to copy the workflow regardless.
                var minimumShipping = transferLocationMinimum !== '' && transferLocationMinimum != undefined ? transferLocationMinimum : locationMinimum;
                var maximumShipping = 500;
                if (shipping > maximumShipping) {
                    shipping = maximumShipping;
                }
                else if (shipping < minimumShipping && trandate > transitionDate && !['1180', '920', '921'].includes(String(entity))) {
                    shipping = minimumShipping;
                }
                else if (shipping < 15 && trandate < transitionDate) {
                    // This part which applies a global minimum cost on old orders should be more or less obsolete now that this script does not run on billed orders
                    shipping = 15;
                }
                // var oldShippingCost = currentRecord.getValue('shippingcost');
                // log.debug(`@setShippingCost: oldShippingCost`, oldShippingCost);
                currentRecord.setValue({ fieldId: 'shippingcost', value: shipping });
            }
        }
        else if (shipmethod == '4640') { // COMMON CARRIER
            // This part of the script is nearly obsolete as only two customers have a filled "Flat Shipping Rate" (custentity_yy_shiprate) (only CLIQ has it as of 7/31/2024 the second customer that had it in the past was a test customer)
            var { custentity_yy_shiprate } = search.lookupFields({ type: search.Type.ENTITY, id: entity, columns: ['custentity_yy_shiprate'] });
            var shiprate = Number(String(custentity_yy_shiprate).replace('%', '')) / 100;
            if (shiprate) {
                shipping = (subtotal - Number(discounttotal || 0)) * shiprate;
                currentRecord.setValue({ fieldId: 'shippingcost', value: shipping });
            }
        }
        if (assembled && entity == '39390') {
            // This customer will generally try to order unassembled cabinets when shipping with common carrier to save money on freight (and assembly)
            // In the event that they order assembled cabinets or for FedEx shipping this will override their 10% upcharge and replace with 15%
            // Replace with manually calculated subtotal just like with CNC Truck
            shipping = subtotal * 0.15;
            currentRecord.setValue({ fieldId: 'shippingcost', value: shipping });
        }
        var shippingcost = Number(currentRecord.getValue('shippingcost') || 0);
        /* if (shippingcost) {
            var tranid = currentRecord.getValue('tranid');
            // This log should match unless shippingcost was entered manually
            if (shippingcost != shipping) {
                log.debug(`@setShippingCost: ${tranid}`, `${shippingcost}, ${shipping}`);
            }
        } */
        // The first time I made this script live I set the shipping cost here
        // but forgot the if condition (if shipping is not 0), leading to shipping disappearing from orders (Common Carrier and Fedex).
        // Fortunately, a few days prior I had moved the execution of this script to precede "Require Shipping Cost".
        // It still took 16 minutes until I was notified. However due to the "Require Shipping Cost" popup, customer service noticed this
        // and clicked override on most of their orders and therefore little to no orders were affected.
        // CSV imports were also not affected as this is still a client script.
        // if (shipping)
        //     currentRecord.setValue({fieldId: 'shippingcost', value: shipping});
        return true;
    } // Support function for NKSSCCSetShippingAndCountertopCost
    function setHandlingCost(context) {
        var { newRecord } = context;
        var currentRecord = newRecord;
        var handlingcost = Number(currentRecord.getValue({ fieldId: 'handlingcost' }) || 0);
        // Failsafe field saves the value in case of the NS bug that randomly clearing site fees
        var custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
        /*  if ((handlingcost || custbody_yy_so_handlingcost) && handlingcost != custbody_yy_so_handlingcost) {
             log.debug(`@setHandlingCost: handlingcost: ${handlingcost}`, `custbody_yy_so_handlingcost: ${custbody_yy_so_handlingcost}`);
         } */
        currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
        // Manual site fee
        var override = currentRecord.getValue('custbody_yy_so_nositefee');
        // Check if customer doesn't pay site fee
        var entity = Number(currentRecord.getValue('entity'));
        let customerExclusion = query.runSuiteQL({
            query: `
        SELECT custentity_rsm_excl_from_site_fee AS excl
        FROM customer
        WHERE id = '${entity}'
      `
        }).asMappedResults();
        if (override || (customerExclusion[0] && customerExclusion[0].excl === 'T')) {
            return true;
        }
        var shipmethod = currentRecord.getValue('shipmethod');
        // Customer pick up (no site fee)
        if (['80326', '62060', '68503'].includes(String(shipmethod))) { // Express, Pick Up, CPU (Customer Pick Up)
            currentRecord.setValue({ fieldId: 'custbody_yy_so_handlingcost', value: 0 });
            custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
            currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
            return true;
        }
        var subtotal = Number(currentRecord.getValue('subtotal') || 0);
        var discounttotal = Number(currentRecord.getValue('discounttotal') || 0);
        subtotal -= Math.abs(discounttotal);
        var freightIncluded = currentRecord.getValue('custbody16');
        var discountitem = currentRecord.getValue('discountitem');
        if (!entity) {
            // Likely xedit which we may need to cover for but leaving it for now
            custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
            currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
            return true;
        }
        // TODO: Retrieve these values from the above customer query instead
        var entityFields = search.lookupFields({ type: search.Type.ENTITY, id: entity, columns: ['custentity_mb_markup', 'custentity_yy_shiprate'] });
        // markup: cncTruckMarkup
        var markup = entityFields.custentity_mb_markup;
        markup = Number(String(markup).replace('%', '')) / 100;
        let location = Number(currentRecord.getValue({ fieldId: 'location' }));
        let source = currentRecord.getValue({ fieldId: 'source' });
        let trandate = currentRecord.getValue({ fieldId: 'trandate' });
        if (subtotal <= 0 || freightIncluded || !markup || discountitem == '67258' || ['80326', '62060', '68503'].includes(String(shipmethod))) {
            currentRecord.setValue({ fieldId: 'custbody_yy_so_handlingcost', value: 0 });
            custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
            currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
            return true;
        }
        //
        else if ((shipmethod == '97162' || shipmethod == 16) && location === 7 && source !== 'Web (Cabnet by CNC Cabinetry)' && new Date(String(trandate)) > new Date('06-16-2025')) { //if inside delivery or CNC Truck
            let fee = 0;
            let zipcode = currentRecord.getValue({ fieldId: 'shipzip' });
            let results = query.runSuiteQL({
                query: `
          SELECT custrecord_ata_congestion AS mprice, custrecord_ata_crz_zip AS cprice
          FROM customrecord_fd_ata_zipcode
          WHERE custrecord_ata_zipcode = '${zipcode}'
        `
            }).asMappedResults();
            if (shipmethod == '97162') { //if it's inside delivery
                // We may need to make adjustments for these prices in the event of inside delivery for default shipping addresses
                if (results[0] && results[0].mprice == 'T') { //if the zip is in manhattan
                    fee = 325;
                }
                else {
                    fee = 200;
                }
                if (results[0] && results[0].cprice == 'T') { //if the current zipcode is one of the manhattan congestion fee zips then add on a $13 charge
                    fee += 13;
                }
            }
            else if (String(shipmethod) == '16') { //any order using CNC truck
                let shipaddress = currentRecord.getValue({ fieldId: 'shipaddress' });
                let entity = currentRecord.getValue({ fieldId: 'entity' });
                // Check in case of slowdowns due to multiple joins (remove this log once reasonable numbers come in consistently)
                let companyAddressesResults = query.runSuiteQL({
                    query: `
            SELECT addrtext, defaultshippingaddress, addressbookaddress, custrecord_rsm_primary_address AS primary
                FROM customeraddressbook
                JOIN customeraddressbookentityaddress ON customeraddressbook.addressbookaddress = customeraddressbookentityaddress.nkey
                JOIN customer ON customer.id = customeraddressbook.entity
                WHERE 
                entity = '${entity}' AND (
                    customeraddressbook.addressbookaddress = customer.defaultshippingaddress
                    OR custrecord_rsm_primary_address = 'T'
                )
        `
                }).asMappedResults();
                // If a customer has a primary address or multiple then do not include the NS native default address
                const hasPrimaryAddress = companyAddressesResults.some(addr => addr.primary === 'T');
                if (hasPrimaryAddress) {
                    companyAddressesResults = companyAddressesResults.filter(addr => addr.primary === 'T');
                }
                const normalize = s => String(s).replace(/\s+/g, ' ').trim();
                const companyAddresses = companyAddressesResults.map(addr => normalize(addr.addrtext));
                // There are often whitespace mismatches
                if (!companyAddresses.includes(normalize(shipaddress))) { //if the order isn't the default address
                    let EXP = [1003, 21423, 12053, 1006]; //all EXP customers
                    // Commented out due to many incorrect default shipping addresses (consider using the new Primary Address custom field instead)
                    // fee = EXP.includes(entity) ? 100 : 125; //EXP gets a $100 site fee starting 06-24-2025
                    if (results[0].mprice == 'T') { //if cnc truck and manhattan
                        fee = 225;
                    }
                    if (results[0].cprice == 'T') { //if the current zipcode is one of the manhattan congestion fee zips then add on a $13 charge
                        fee += 13;
                    }
                }
            }
            const createddate = new Date(String(currentRecord.getValue({ fieldId: 'createddate' })));
            if (createddate >= new Date('06-16-2025')) { //Only add fee to orders created on or after June 16, 2025 = When this started
                // Do not remove fee (when empty) from orders where it was already set before (mainly due to wrong default ship addresses)
                if (fee) {
                    currentRecord.setValue({ fieldId: 'custbody_yy_so_handlingcost', value: fee });
                    custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
                    currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
                }
            }
            return true;
            // Archived query from before we started using the primary address field
            // let defaultAddressResults = query.runSuiteQL({
            //     query: `
            //     SELECT  cab.addrtext
            //     FROM customeraddressbookentityaddress cab
            //     WHERE cab.nkey = (SELECT defaultshippingaddress FROM customer WHERE id = '${entity}' )
            // `}).asMappedResults();
        }
        handlingcost = Number(currentRecord.getValue({ fieldId: 'handlingcost' }));
        custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
        if ((handlingcost || custbody_yy_so_handlingcost) && handlingcost != custbody_yy_so_handlingcost) {
            currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
        }
        return true;
    } // Support function for NKSSCCSetShippingAndCountertopCost
    function clearClosedLineCost(context) {
        var { newRecord } = context;
        var currentRecord = newRecord;
        var lineCount = currentRecord.getLineCount({ sublistId: 'item' });
        var linesClosed = [];
        for (var line = 0; line < lineCount; line++) {
            var isclosed = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: line });
            if (isclosed) {
                linesClosed.push(line); // Consolidate for logs
                var amount = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line });
                // If the line was just closed clear the cost and move it to a custom field
                if (amount) {
                    // Exit if this function was called from a client script the return value signals that tax needs to recalculate
                    if (!currentRecord.setSublistValue) {
                        return true;
                    }
                    // Save the amount prior to close to a custom field so we can put it back if the line reopens
                    currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: line, value: 0 });
                    currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol6', line: line, value: amount });
                }
            }
            else if (!isclosed) {
                // Exit if this function was called from a client script the return value signals that tax needs to recalculate
                if (!currentRecord.setSublistValue) {
                    return true;
                }
                var closedAmount = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol6', line });
                // If the line was just reopened reenter the cost saved in the custom field
                if (closedAmount) {
                    currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: line, value: closedAmount });
                    currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol6', line: line, value: 0 });
                    // Uncheck "Paid in Full" as we added a the item's cost's to the lines, the (Sales Order Defaults) workflow will recheck it if needed.
                    currentRecord.setValue({ fieldId: 'custbody_mb_paid_in_full', value: false });
                    const terms = currentRecord.getValue('terms');
                    if (terms == 9) { // Paid In Full (Oddly, the order's CIA terms to "Paid In Full" terms when paid (even though it's tecnically not its own term), we would like to change it back)
                        currentRecord.setValue({ fieldId: 'terms', value: 7 });
                    }
                }
            }
        }
        /*    if (linesClosed.length) {
               var tranid = currentRecord.getValue('tranid');
               log.debug('@clearClosedLineCost: sales order with closed lines saved', `${tranid} line: ${linesClosed.join(', ')}`);
           } */
    } // Support function for NKSSCCSetShippingAndCountertopCost
    function setCountertopCost(context) {
        var { newRecord, type } = context;
        var currentRecord = newRecord;
        var tranid = currentRecord.getValue('tranid');
        var lineCount = currentRecord.getLineCount({ sublistId: 'item' });
        for (var line = 0; line < lineCount; line++) {
            var collection = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: line }); // YY
            var description = String(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'description', line: line }));
            if (collection == 9 || description.endsWith("EDGEBAND")) { // YY added description
                var total = 0;
                var rate = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: line }) || 0);
                var quantity = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: line }) || 0);
                var uom = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_uom', line: line }) || 0);
                /*  rate = parseFloat(rate);
                 quantity = parseFloat(quantity);
                 uom = parseFloat(uom); */
                if (uom) {
                    // As per Jennifer 3/26/2025 DIRSUP minimum is 2 not 3 (see helpdesk ticket 8952). If additional child customers of DIRSUP get entered the script will need to include them
                    var entity = currentRecord.getValue('entity');
                    var createddate = currentRecord.getValue('createddate') || currentRecord.getValue('datecreated');
                    var minimum = [920, 921].includes(Number(entity)) && new Date(String(createddate)).getTime() > new Date('3/26/2025 1:00 pm').getTime() ? 2 : 3;
                    if (uom > minimum || description.endsWith("EDGEBAND")) {
                        total = quantity * uom * rate;
                    }
                    else {
                        total = quantity * minimum * rate;
                    }
                    var oldTotal = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line }) || 0;
                    if (!currentRecord.setSublistValue) { // Client script
                        return true;
                    }
                    currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: line, value: total });
                    /* if (parseFloat(total.toFixed(2)) != oldTotal) {
                        if (type == context.UserEventType.CREATE || !oldTotal) {
                            log.debug(`@setCountertopCost: ${tranid} Countertop Amount Set`, currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line }));
                        }
                        else {
                            log.debug(`@setCountertopCost: ${tranid} COUNTERTOP AMOUNT CHANGED`, `Old Value: ${oldTotal}; New Value: ${total}`);
                        }
                    } */
                }
            }
        }
    } // Support function for NKSSCCSetShippingAndCountertopCost
    function NKSSCCSetShippingAndCountertopCost(context) {
        // Many changes made since this was first added. Please reenter from the live file together with the helper functions.
    }
    function AHChangeItem(context) {
        const newRecord = context.newRecord;
        // if the customer is Kitchen and Bath Center or MBSUP or one of their child companies
        if (new Date(String(newRecord.getValue('trandate'))) < (new Date('2024-11-22'))) {
            return;
        }
        const customerId = String(newRecord.getValue('entity'));
        const parent = String(newRecord.getValue('custbody_ah_entity_parent'));
        const ids = ["89759", "117606"];
        if (ids.includes(customerId) || ids.includes(parent)) {
            const numLines = newRecord.getLineCount('item');
            // if the item includes any values to change, set it to the new value
            for (let i = 0; i < numLines; i++) {
                const itemtype = String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i }));
                if (!['Assembly', 'InvtPart'].includes(itemtype)) {
                    continue;
                }
                let itemId = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }); //get the id of the item
                let itemName = query.runSuiteQL({ query: `SELECT id, itemid FROM item WHERE id = '${itemId}'` }).asMappedResults(); //find the name for that id
                let item = String(itemName[0].itemid);
                if ((item.includes('DWR3') || item.includes('REP1') || item.includes('REP3')) && item != undefined) {
                    item += '-A'; //change the name
                    const idnumber = query.runSuiteQL({
                        query: `
                        SELECT id, itemid FROM item WHERE itemid = '${item}'
                    `
                    }).asMappedResults(); //find the new id number
                    if (idnumber[0]) {
                        newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: i, value: Number(idnumber[0].id) }); //set the item value = to new item
                    }
                    else {
                        log.error("@AHChangeItem: Item does not have a corresponding '-A'", item);
                    }
                }
            }
        }
    }
    function NKUESOSetReplacementSOID(context) {
        try {
            const newRec = context.newRecord;
            const shipDate = newRec.getValue('shipdate');
            // Set body field
            newRec.setValue({
                fieldId: 'custbody_yy_nk_shipdate',
                value: shipDate
            });
            // Loop through the item sublist
            const lineCount = newRec.getLineCount({ sublistId: 'item' });
            for (let i = 0; i < lineCount; i++) {
                newRec.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'expectedshipdate',
                    line: i,
                    value: shipDate
                });
            }
        }
        catch (e) {
            log.error('Error', e.message);
        }
    }
    function AHAvailableStock(context) {
        try {
            const newRecord = context.newRecord;
            const entity = newRecord.getValue({ fieldId: 'entity' });
            const customerList = ['5733', '152809']; // INT, INT-NHC (customers that this script should run for)
            if (!customerList.includes(String(entity))) { //if the customer is not in the customer list
                return;
            }
            const itemQuantities = query.runSuiteQL({
                query: `
          SELECT transaction.id, BUILTIN.DF(status) AS status, transaction.entity, item, ABS(quantity) AS quantity
          FROM transaction
                 JOIN transactionline
                      ON transactionline.transaction = transaction.id
                 JOIN item
                      ON item.id = transactionline.item
          WHERE  BUILTIN.DF(transaction.status) IN ('Sales Order : Pending Approval', 'Quote : Open')
            AND transaction.entity = ${entity}
        `
            }).asMappedResults(); //get all the open quotes and sales orders with no wo with their items and quantities
            let itemDict = new Object();
            let items = [];
            for (let i = 0; i < itemQuantities.length; i++) {
                if (!itemDict[String(itemQuantities[i].item)]) {
                    itemDict[String(itemQuantities[i].item)] = 0;
                }
                itemDict[String(itemQuantities[i].item)] += itemQuantities[i].quantity; //create a dict to map items to quantities
            }
            const lineCount = newRecord.getLineCount({ sublistId: 'item' });
            for (let i = 0; i < lineCount; i++) { //get the current transaction items
                const curItem = String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
                const curQuantity = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
                if (!items.includes(curItem)) {
                    items.push(curItem); //make an array of unique items on the transaction
                }
                itemDict[curItem] += curQuantity; //add this transactions items to the item dict
            }
            const availability = cnc_functions.maxQtyBuildable_nk_mqb_util({ itemsLines: items, subsidiaryId: 2, locationId: 12, custbody_yy_nfp: true }); //get the boms for each item
            let unavailable = [];
            for (let i = 0; i < items.length; i++) { //go through each item on transaction and check if it is greater than what is available
                let availableBoms = availability[items[i]].boms;
                let maxQ = 0;
                for (let j = 0; j < availableBoms.length; j++) {
                    if (availableBoms[j].mqb > maxQ) { //get the largest quantity availble for each item
                        maxQ = availableBoms[j].mqb;
                    }
                }
                if (itemDict[items[i]] > maxQ) { // if there's more ordered than in inventory then add to unavailable array
                    unavailable.push(items[i]);
                }
            }
            for (let i = 0; i < lineCount; i++) { //mark the record field that there isn't enough available
                if (unavailable.includes(String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i })))) {
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_all_quotes_buildable', value: 'NO', line: i });
                }
            }
        }
        catch (e) {
            log.error("@AHAvailableStock", e.message);
        }
    }
    function automateModCharges(context) {
        const { newRecord } = context;
        let chargeItem = 306578;
        // Can hard code or cache for performance
        const results = query.runSuiteQL({
            query: `
                SELECT
                    mc.custrecord_nk_modification_field_id AS modificationId,
	                mc.custrecord_nk_mod_charge AS chargeId,
	                mc.custrecord_nk_modification_selection as optionName,
	                mc.custrecord_nk_mod_selection_id as optionId,
                    mc.custrecord_nk_mod_charge_item_type as cabinetTypeId,
                    BUILTIN.DF(mc.custrecord_nk_mod_charge_item_type) as cabinetType
                FROM
	                customrecord_nk_modification_charge as mc
                JOIN
	                item ON item.id = mc.custrecord_nk_mod_charge
            `
        }).asMappedResults();
        const autoChargedModifications = [...new Set(results.map(result => String(result.modificationid)))];
        //log.debug('autoChargedModifications', autoChargedModifications)
        const mappedResults = results.map(({ modificationid, chargeid, optionid, optionname, cabinettype, cabinettypeid }) => ({
            modificationid: String(modificationid),
            chargeid: String(chargeid),
            optionid: optionid && optionname && (String(optionid) + '::' + String(optionname)) || '*',
            cabinettypes: cabinettype && cabinettypeid && (String(cabinettypeid).split(', ').map((val, idx) => val + '::' + String(cabinettype).split(', ')[idx])) || ['*']
        }));
        //log.debug('mappedResults', mappedResults);
        const modificationSpecifications = mappedResults.reduce((lookup, result) => {
            const { modificationid, chargeid, optionid, cabinettypes } = result;
            for (const itemtype of cabinettypes) {
                lookup[itemtype] ||= {};
                lookup[itemtype][String(modificationid)] ||= {};
                lookup[itemtype][String(modificationid)][optionid] = String(chargeid);
            }
            return lookup;
        }, {});
        const lookup = new Proxy(modificationSpecifications, {
            get(target, cabType) {
                // Top-level numeric redirect: "1" → "1::CABINET XYZ"
                if (cabType === '') {
                    cabType = '*';
                }
                else if (!(cabType in target) && /^\d+$/.test(String(cabType))) {
                    const alt = Object.keys(target).find(k => k.startsWith(String(cabType) + "::"));
                    if (alt)
                        cabType = alt;
                }
                const cabinet = target[String(cabType)] || target["*"] || {};
                return new Proxy({}, {
                    get(_, field) {
                        const fieldData = cabinet[String(field)] || target["*"] && target["*"][String(field)] || {};
                        return new Proxy({}, {
                            get(__, selection) {
                                if (!Number(selection)) {
                                    return;
                                }
                                if (selection in fieldData)
                                    return fieldData[String(selection)];
                                // Mid-level redirect: "5" → "5::..."
                                if (/^\d+$/.test(String(selection))) {
                                    const altKey = Object.keys(fieldData).find(k => k.startsWith(String(selection) + "::"));
                                    if (altKey)
                                        return fieldData[altKey];
                                }
                                // Fallback to "*"
                                return fieldData["*"];
                            }
                        });
                    }
                });
            }
        });
        // const modificationSpecifications = groupBy(results, result => result.modificationid)
        if (runtime.envType === runtime.EnvType.SANDBOX) {
            chargeItem = 297832;
        }
        //log.debug('modificationSpecifications', modificationSpecifications);
        const source = newRecord.getValue({ fieldId: 'source' });
        // let standardBlum = [348, 518, 396, 395, 519, 398, 397, 586, 578, 576, 577, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541, 542, 543, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531];
        let chargeApplied = newRecord.getValue({ fieldId: 'custbody_ah_charges_applied' }); //if the charge was already added to the order
        if (source === 'Web (Cabnet by CNC Cabinetry)') { //if cabnet order don't apply charges
            chargeApplied = true; //Cabnet sets charges already
        }
        let blumCharge = 0;
        const allLinesAppliedToItemLines = [];
        const charges = Object.fromEntries(autoChargedModifications.filter(mod => mod != 'custcol_yy_mod_blumhinges').map(key => [key, []]));
        let lineCount = newRecord.getLineCount({ sublistId: 'item' });
        let addedOffset = 0;
        for (let i = 0; i < lineCount; i++) {
            const line = i + addedOffset; // Want the variable i to represent the initial line position
            const curItem = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }));
            const itemtype = String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line }));
            const blumOptions = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_mod_blumhinges', line });
            const cabType = String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_type', line }));
            if (['Assembly', 'InvtPart'].includes(itemtype)) { //when click into mods all other available mods give a weird icon as the value
                // Do we need this line? Can we instead have the function check if chargesApplied === false (before the loop) and exit? - YNK 7/8/2025
                if (blumOptions === '1') {
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_blum_hinges', line, value: true });
                    if (!chargeApplied) {
                        const amount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line }));
                        blumCharge += amount * .1; //10% upcharge on each blum upgrade item.
                    }
                }
                else if (newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_blum_hinges', line: i })) {
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_blum_hinges', line: i, value: false });
                }
                const allLinesAppliedToThisItemLine = {};
                for (let nextLine = line + 1; line <= lineCount; nextLine++) {
                    const nextItemType = String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: nextLine }));
                    if (!nextItemType || ['Assembly', 'InvtPart'].includes(nextItemType)) {
                        break;
                    }
                    const nextItem = String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: nextLine }));
                    const nextQuantity = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: nextLine }));
                    allLinesAppliedToThisItemLine[nextItem] = {
                        quantity: (allLinesAppliedToThisItemLine[nextItem]?.quantity || 0) + nextQuantity,
                        lines: allLinesAppliedToThisItemLine[nextItem]?.lines.concat(nextLine) || [nextLine]
                    };
                }
                // If we have a discount on the following line we need to do some maneuvering so that the discount applies to the charge as well
                const initialNextItemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: line + 1 });
                const initialNextItem = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line + 1 });
                const nextItem = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line + 1 });
                //log.debug(String(line), initialNextItemType)
                //log.debug(String(line), nextItem);
                allLinesAppliedToItemLines[i] = allLinesAppliedToThisItemLine;
                for (const [modFieldId, pendingCharges] of Object.entries(charges)) {
                    const selection = String(newRecord.getSublistValue({ sublistId: 'item', fieldId: modFieldId, line }));
                    const lineModCharge = lookup[cabType][modFieldId][selection];
                    const quantity = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line }));
                    if (lineModCharge) {
                        const alreadyAppliedQuantity = allLinesAppliedToThisItemLine[lineModCharge]?.quantity || 0;
                        const unappliedQuantity = quantity - alreadyAppliedQuantity;
                        if (unappliedQuantity) {
                            if (initialNextItemType !== 'Discount') {
                                newRecord.insertLine({ sublistId: 'item', line: line + addedOffset + 1 });
                                newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: line + addedOffset + 1, value: lineModCharge });
                                newRecord.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: line + addedOffset + 1, value: unappliedQuantity });
                                addedOffset++; //prevent from running on a subtotal line again and inserting many blum charge lines
                            }
                            else if (initialNextItemType === 'Discount') {
                                newRecord.insertLine({ sublistId: 'item', line: line + addedOffset + 2 });
                                newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: line + addedOffset + 2, value: lineModCharge });
                                newRecord.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: line + addedOffset + 2, value: unappliedQuantity });
                                addedOffset++; //prevent from running on a subtotal line again and inserting many blum charge lines
                                newRecord.insertLine({ sublistId: 'item', line: line + addedOffset + 2 });
                                newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: line + addedOffset + 2, value: initialNextItem });
                                newRecord.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: line + addedOffset + 2, value: 1 });
                                addedOffset++; //prevent from running on a subtotal line again and inserting many blum charge lines
                            }
                            lineCount = newRecord.getLineCount({ sublistId: 'item' });
                        }
                        // Recording for logs
                        const lineAdditionalCharges = [lineModCharge, quantity];
                        pendingCharges[i] = lineAdditionalCharges;
                    }
                }
            }
            else if (curItem === -2 && !chargeApplied && blumCharge > 0) { //if it's a subtotal item (only required for blum hinges which should otherwise go to the bottom)
                newRecord.insertLine({ sublistId: 'item', line });
                newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line, value: chargeItem });
                newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line, value: blumCharge });
                newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true }); //set to true if added here (will still be able to add the rest)
                lineCount = newRecord.getLineCount({ sublistId: 'item' });
                addedOffset++; //prevent from running on a subtotal line again and inserting many blum charge lines
                blumCharge = 0;
            }
            else if (itemtype === 'Discount' && !chargeApplied) {
                const prevItem = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line - 1 }));
                if (prevItem !== -2) { //make sure this is not a discount after a subtotal
                    let prevItemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: line - 1 });
                    let subtractNum = 1; //amount of lines to go back after a discount (there may be a charge)
                    while (prevItemType !== 'Assembly' && prevItemType !== 'InvtPart') {
                        subtractNum++;
                        prevItemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: line - subtractNum });
                    }
                    const itemAmount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line - subtractNum }));
                    blumCharge -= itemAmount * .1; //remove the amount that was already added to the charge variable
                    const discountAmount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line }));
                    const subtotal = itemAmount + discountAmount;
                    blumCharge += subtotal * .1; //add on the charge after the discount is applied
                }
            }
        }
        if (blumCharge > 0) { //if there's a charge still, add it to the bottom of the order
            newRecord.insertLine({ sublistId: 'item', line: lineCount });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: lineCount, value: chargeItem });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: lineCount, value: blumCharge });
            newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true });
            lineCount = newRecord.getLineCount({ sublistId: 'item' });
            // blumCharge = 0;
        }
        ;
        // Log the current line setup
        const output = [];
        for (let line = 0; line < lineCount; line++) {
            output.push({
                item: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }),
                quantity: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line }),
                amount: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line }),
            });
        }
        /* log.debug('output', output);
        log.debug('charges', charges);
        log.debug('allLinesAppliedToItemLines', allLinesAppliedToItemLines); */
    }
    function AHAutomateTransfersBeforeSubmit(context) {
        try {
            const curRecord = context.newRecord;
            const oldRecord = context.oldRecord;
            let lineCount = curRecord.getLineCount({ sublistId: 'item' });
            let location = Number(curRecord.getValue({ fieldId: 'location' }));
            let largeOrder = curRecord.getValue({ fieldId: 'custbody27' });
            let nfp = curRecord.getValue({ fieldId: 'custbody_yy_nfp' });
            let transferCreated = curRecord.getValue({ fieldId: 'custbody_yy_so_to_xferrecord' });
            let shipmethod = Number(curRecord.getValue({ fieldId: 'shipmethod' }));
            let keepLocation = curRecord.getValue({ fieldId: 'custbody_ah_keeplocation' });
            if (transferCreated) { //if a transfer order was already created then return (don't want to keep moving the date)
                return;
            }
            if (location === 7 || location === 13) { //if it's nj then return or dropship
                return;
            }
            if (curRecord.getValue({ fieldId: 'custbody_ah_manual_transfers' })) {
                return;
            }
            let items = [];
            //#region Decide Transfer
            for (let i = 0; i < lineCount; i++) { //get all the items that need to be transferred from the so
                let curItem = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
                //let buildable = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_buildable', line: i });
                let cncclass = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_cncclass', line: i }));
                let collection = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: i }));
                let itemtype = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
                let quantity = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }));
                let cfg = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_cut_for_glass', line: i }); //cut for glass
                let wce = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_con_wall_cut_down_extend', line: i }));
                let finishedinterior = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_finished_interior', line: i });
                let itemgroup = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_fd_tls_item_group', line: i }));
                let itemtypecust = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_type', line: i }));
                let bct = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_mod_cutdown', line: i }));
                items.push({ item: curItem, cncclass, collection, itemtype, quantity, cfg, wce, finishedinterior, itemgroup, itemtypecust, line: i, bct });
            }
            const { loc, itemsForTs, tsNeeded } = (0, cnc_functions.decideTransfer)(location, shipmethod, items, !!keepLocation);
            curRecord.setValue({ fieldId: 'location', value: loc });
            if (!tsNeeded) {
                return;
            }
            log.debug('@AHAutomateTransfersBeforeSubmit: itemsForTs', itemsForTs);
            for (const item of itemsForTs) {
                curRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_transfernecessary', line: item.line, value: true });
            }
            //#endregion
            if (tsNeeded) {
                let shipDateField = curRecord.getValue({ fieldId: 'shipdate' });
                let shipDate = new Date(String(shipDateField));
                //get the latest lead time
                const lineCount = curRecord.getLineCount({ sublistId: 'item' });
                let latest = new Date(String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_lead_time', line: 0 })));
                for (let i = 0; i < lineCount; i++) {
                    let leadTime = new Date(String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_lead_time', line: i })));
                    if (leadTime > latest) {
                        latest = leadTime;
                    }
                }
                let difInMilliseconds = latest.getTime() - shipDate.getTime();
                const millisecondsInADay = 24 * 60 * 60 * 1000;
                let dayDifference = difInMilliseconds / millisecondsInADay;
                if (!(dayDifference < 0) || !(dayDifference > -21)) { //only run if shipdate is within 3 weeks of the leadtime
                    const truckDays = { '16': 2, '11': 5, '10': 3, '12': 4 }; //SC: Tuesday, FL: Friday, NV: Wednesday, TX: Thursday
                    let shipDay = shipDate.getDay();
                    let subtractDays = 0;
                    for (let i = 0; i < 7; i++) {
                        let curDay = (shipDay - i + 7) % 7; //make sure no negatives
                        subtractDays = i;
                        if (curDay == truckDays[location.toString()]) {
                            break;
                        }
                    }
                    let xferDate = new Date(shipDate);
                    xferDate.setDate(xferDate.getDate() - (subtractDays + 7)); //add in another 7 days
                    //#region check for blackout
                    let blackout = query.runSuiteQL({
                        query: `
              SELECT TO_DATE(custrecord13) AS date, custrecord_ah_truckschedule AS days
              FROM customrecord_yy_blackout
              WHERE custrecord13 > CURRENT_DATE
            `
                    }).asMappedResults();
                    let blackoutDates = {};
                    for (let i = 0; i < blackout.length; i++) { //get all the blackout dates that a truck doesn't go out
                        blackoutDates[String(blackout[i].date)] = blackout[i].days;
                    }
                    let formattedDate = xferDate.toLocaleDateString();
                    if (formattedDate in blackoutDates) {
                        log.audit('@AHAutomateTransfersBeforeSubmit: after3weeksblackoutDate', xferDate.toLocaleDateString());
                        xferDate.setDate(xferDate.getDate() - 7); //if it's a blackout date push it to the week before
                    }
                    formattedDate = xferDate.toLocaleDateString();
                    if (formattedDate in blackoutDates) { //check again if it's a blackout date (only applicable for yom tov)
                        log.audit('@AHAutomateTransfersBeforeSubmit: after3weekssecondblackoutDate', xferDate.toLocaleDateString());
                        xferDate.setDate(xferDate.getDate() + Number(blackoutDates[formattedDate]));
                    }
                    //#endregion
                    curRecord.setValue({ fieldId: 'custbody_yy_qu_transfercheck', value: true }); //check the To Be Transferred Checkbox
                    curRecord.setValue({ fieldId: 'custbody_yy_so_shippref', value: 1 }); //fix error that says xfer must be ship complete
                    if (!curRecord.getValue({ fieldId: 'custbody_ah_rush_order' })) {
                        curRecord.setValue({ fieldId: 'custbody_yy_so_xferdate', value: xferDate });
                    }
                }
            }
        }
        catch (e) {
            log.error('@AHAutomateTransfersBeforeSubmit: Error Setting Transfer Date', e.message + 'stack: ' + e.stack);
        }
    }
    function AHLocationChange(context) {
        const { newRecord, oldRecord } = context;
        try {
            let update = newRecord.getValue('custbody_ah_update_wo_location');
            if (!update || !oldRecord) { // TS Appease: If !oldRecord then on create it won't have work orders and it will exit out via the try catch
                return;
            }
            //if the user changed the location of the sales order
            if (oldRecord.getText('location') !== newRecord.getText('location')) {
                const soId = newRecord.id;
                const newLocation = newRecord.getValue('location');
                //get all work orders where the location is not the same as the sales order it's connected to.
                const workOrders = query.runSuiteQL({
                    query: `
            SELECT transactionline.id, transactionline.location, previoustransactionlink.nextdoc, previoustransactionlink.linktype FROM transactionline
            JOIN previoustransactionlink
                ON nextdoc = transactionline.transaction
            WHERE previoustransactionlink.previousdoc = ${soId}
            AND previoustransactionlink.linktype = 'SpecOrd'
            AND transactionline.location != ${newLocation}
        `
                }).asMappedResults();
                //change the location for 1 transaction line per transaction id
                const uniqueIds = [];
                for (let i = 0; i < workOrders.length; i++) { //go through all the work orders
                    if (!uniqueIds.includes(Number(workOrders[i].nextdoc))) {
                        uniqueIds.push(Number(workOrders[i].nextdoc));
                        let curWorkOrder = record.load({ type: record.Type.WORK_ORDER, id: String(workOrders[i].nextdoc), isDynamic: true }); //load current wo
                        let assemblyItem = curWorkOrder.getValue('assemblyitem'); // reset some of the fields
                        curWorkOrder.setValue('assemblyitem', '').setValue('assemblyitem', assemblyItem);
                        let billOfMaterials = curWorkOrder.getValue('billofmaterials');
                        curWorkOrder.setValue('billofmaterials', '').setValue('billofmaterials', billOfMaterials);
                        curWorkOrder.setValue('location', '').setValue('location', newLocation).save();
                    }
                }
            }
        }
        catch (e) {
            log.error('@AHLocationChange', e.message);
        }
    }
    // When selecting Braintree Payment Request Link via the UI it generates a payment link on save. This script would automate it but wasn't compatible with a recent Braintree SuiteApp update.
    function YYSetBTLinks(context) {
        const ALLOWED_TERMS_IDS = ['7', '8']; // (CIA, COD-2)
        const TARGET_PAYMENT_OPTION = '513373'; // (Braintree Payment Request Link)
        const PAYMENT_PROCESSING_PROFILE = '3'; // (Braintree)
        const excludedCOD = ['1', '2']; // (Cash, Check on Delivery)
        const newRec = context.newRecord;
        try {
            const terms = String(newRec.getValue('terms'));
            const otherrefnum = newRec.getValue('otherrefnum');
            const entity = newRec.getValue('entity');
            const currentPaymentOption = String(newRec.getValue('paymentoption'));
            const currentPaymentProfile = String(newRec.getValue('paymentprocessingprofile'));
            const soCOD = String(newRec.getValue('custbody_yy_so_cod') ?? '');
            const paidInFull = newRec.getValue('custbody_mb_paid_in_full') === true;
            const shouldRun = ALLOWED_TERMS_IDS.includes(terms) &&
                currentPaymentOption !== TARGET_PAYMENT_OPTION &&
                currentPaymentProfile != PAYMENT_PROCESSING_PROFILE &&
                !excludedCOD.includes(soCOD) &&
                !paidInFull;
            if (shouldRun) {
                newRec.setValue({ fieldId: 'paymentoption', value: TARGET_PAYMENT_OPTION });
                newRec.setValue({ fieldId: 'paymentprocessingprofile', value: PAYMENT_PROCESSING_PROFILE });
                newRec.setValue({ fieldId: 'handlingmode', value: 'PROCESS' });
                // newRec.setValue({ fieldId: 'terms', value: null }); // Keep or remove based on your needs
            }
        }
        catch (e) {
            log.error('@YYSetBTLinks', e.message);
        }
    }
    function getFullLineDetails(curRecord, mods, lines) {
        // TODO: Add lead times for InvtPart so we can include them as well
        const leadTimeItemTypes = ['Assembly', 'Inventory' /*, 'InvtPart'*/];
        const linesDetails = lines.map(line => {
            let hasMods = false;
            return {
                item: curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }),
                itemtype: curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line }),
                quantity: curRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line }),
                location: curRecord.getValue('location'),
                shipmethod: curRecord.getValue('shipmethod'),
                rush: curRecord.getValue('custbody_mb_so_add_on_accessories'),
                mods: Object.keys(mods).reduce((acc, val) => {
                    const option = curRecord.getSublistValue({ sublistId: 'item', fieldId: val, line });
                    if (option) {
                        acc[val] = option;
                        hasMods = true;
                    }
                    return acc;
                }, {}),
                hasMods,
                line
            };
        }).filter(line => leadTimeItemTypes.includes(line.itemtype));
        return linesDetails;
    } // Support function for AH_ItemLeadTime_UEBeforeSubmit
    function AH_ItemLeadTime_UEBeforeSubmit(context) {
        const curRecord = context.newRecord;
        let response;
        let fullDetails;
        try { // Can remove once we know that the getLeadTime function never throws
            const status = curRecord.getValue('status');
            const orderstatus = curRecord.getValue({ fieldId: 'orderstatus' });
            // CSV imports can come through with no orderstatus set on the quote (therefore always run on create)
            if (context.type !== context.UserEventType.CREATE && (curRecord.type === record.Type.SALES_ORDER && orderstatus !== 'A' || curRecord.type === record.Type.ESTIMATE && curRecord.getValue('status') !== 'Open')) {
                return;
            }
            if ([runtime.ContextType.CSV_IMPORT, runtime.ContextType.WEBSTORE, runtime.ContextType.MAP_REDUCE].includes(runtime.executionContext) || String(runtime.getCurrentUser().id) === '94242') {
                let mods = {
                    'custcol_yy_mod_boxonly': 2, 'custcol_yy_mod_chase': 5,
                    'custcol_mb_so_cut_down_extend': 5, 'custcol_yy_mod_sinkbase': 2,
                    'custcol_yy_mod_custom_color': 10, 'custcol_yy_mod_cut_extend': 5,
                    'custcol_yy_mod_custom_item': 10, 'custcol_mb_so_custom_modification': 10,
                    'custcol_mb_so_cut_for_glass': 5, 'custcol_yy_mod_cutdown': 5,
                    'custcol_yy_mod_toekick': 5, 'custcol_er_mod_cutwidth': 5,
                    'custcol_yy_mod_extend': 5, 'custcol_mb_so_finished_interior': 5,
                    'custcol_nk_mod_finishedside': 2, 'custcol_nk_mod_fulldepthshelf': 2,
                    'custcol_nk_mod_hingeside': 2, 'custcol_er_mod_hood': 5,
                    'custcol_yy_mod_cplus_color': 10, 'custcol_er_mod_cplus_stain': 10,
                    'custcol_yy_mod_revashelf': 10, 'custcol_yy_mod_revashelf_2': 10,
                    'custcol_yy_mod_revashelf_3': 10, 'custcol_nk_mod_samplematch': 5,
                    'custcol_nk_mod_single_df': 2, 'custcol_mb_con_wall_cut_down_extend': 5
                };
                const lineCount = curRecord.getLineCount('item');
                // Don't worry "Iterator.range" is on the way
                const lines = Array.from({ length: lineCount }, (_, i) => i);
                fullDetails = getFullLineDetails(curRecord, mods, lines);
                response = (0, cnc_functions.getLeadTime)(fullDetails);
                for (const detail of fullDetails) { //if the line has mods then use the mod ship date
                    let shipdate = detail.hasMods ? (response[detail.item].modshipdate || response[detail.item].shipdate) : response[detail.item].shipdate;
                    if (new Date(shipdate).toString() !== 'Invalid Date') {
                        // Date fields can only be set with a Date object (in UE scripts as it may work in client scripts)
                        curRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_lead_time', line: detail.line, value: new Date(shipdate) });
                    }
                }
            }
        }
        catch (e) {
            log.error('@AH_ItemLeadTime_UEBeforeSubmit', JSON.stringify({ id: curRecord.id, message: e.message, stack: e.stack }));
            log.error('@AH_ItemLeadTime_UEBeforeSubmit: fullDetails', fullDetails);
            log.error('@AH_ItemLeadTime_UEBeforeSubmit: response', response);
        }
    }
    function AH_CIA_UE(context) {
        const Terms = {
            CIA: 7
        };
        // Exclude orders created so as not to lose the order data
        if (context.type === context.UserEventType.CREATE) {
            return;
        }
        const { newRecord, oldRecord } = context;
        const approve = context.type == context.UserEventType.APPROVE;
        const orderstatus = newRecord.getValue('orderstatus');
        // If using the approve button or approving via setting the status
        if (approve || ['A'].includes(String(oldRecord?.getValue('orderstatus'))) && orderstatus == 'B') {
            const entity = Number(newRecord.getValue('entity'));
            let terms = Number(newRecord.getValue({ fieldId: 'terms' }));
            // In case terms is blank on the order (due to BrainTree situations) get the terms from the customer directly
            if (!terms) {
                const result = search.lookupFields({ type: search.Type.CUSTOMER, id: entity, columns: ['terms'] });
                if (result.terms && result.terms[0]) {
                    terms = Number(result.terms[0].value);
                }
            }
            const paid = newRecord.getValue({ fieldId: 'custbody_mb_paid_in_full' });
            if (terms !== 7 || paid || entity === 1781) { //if not cash in advanced
                return;
            }
            const createddate = new Date(Number(newRecord.getValue('createddate')));
            if (createddate.getTime() >= new Date('9/2/2025').getTime()) { // Planned date for go live
                throw new Error('This order can not be approved until the customer pays. (Customer has CIA terms.)');
            }
        }
    }
    function quoteAndSOCustomizationsBeforeSubmit(context) {
        if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.COPY || context.type === context.UserEventType.EDIT || context.type === context.UserEventType.XEDIT) {
            // Get the number of lines in the item sublist
            var lineCount = context.newRecord.getLineCount({ sublistId: 'item' });
            const custbody_mb_so_please_inspect = context.newRecord.getValue('custbody_mb_so_please_inspect');
            const custbody_celigo_etail_channel = context.newRecord.getValue('custbody_celigo_etail_channel');
            // Loop through all item lines
            for (var i = 0; i < lineCount; i++) {
                // If Please Inspect body field is checked, check the Please Inspect column
                if (custbody_mb_so_please_inspect) {
                    context.newRecord.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_mb_qu_so_please_inspect',
                        line: i,
                        value: true
                    });
                }
                const curItemName = context.newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item_display',
                    line: i
                });
                const curItemLPSRate = context.newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol15',
                    line: i
                });
                const curItemQuantity = context.newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: i
                });
                // If etail channel is 102 (LPS) and item ends with -TUP, set amount to LPS rate * quantity
                if (custbody_celigo_etail_channel == 102 && curItemName && curItemName.toString().toUpperCase().endsWith('-TUP')) {
                    context.newRecord.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'amount',
                        line: i,
                        value: Number(curItemLPSRate) * Number(curItemQuantity)
                    });
                }
                // // Check if current line's custcol_mb_so_collection set to 'ALVIC' and custcol_fd_tls_item_group set to 'SAMPLE'
                // const custcol_mb_so_collection = context.newRecord.getSublistText({
                //   sublistId: 'item',
                //   fieldId: 'custcol_mb_so_collection',
                //   line: i
                // })
                // const custcol_fd_tls_item_group = context.newRecord.getSublistText({
                //   sublistId: 'item',
                //   fieldId: 'custcol_fd_tls_item_group',
                //   line: i
                // })
                // if (custcol_mb_so_collection == 'ALVIC' && custcol_fd_tls_item_group == 'SAMPLE') {
                //   needToSetDoNotPrintPL = true
                // }
            }
            // Restrict to not run if context is web store
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                const discountItem = context.newRecord.getValue('discountitem');
                const subtotal = Number(context.newRecord.getValue('subtotal')) || 0;
                const shipMethod = context.newRecord.getValue('shipmethod');
                const gasOverride = context.newRecord.getValue('custbody_mb_gas_charge_override');
                const pickedTest = context.newRecord.getValue('custbody16');
                const customerId = context.newRecord.getValue('entity');
                const { custentity_mb_markup } = search.lookupFields({ type: search.Type.CUSTOMER, id: customerId, columns: ['custentity_mb_markup'] });
                const overrideSiteFee = context.newRecord.getValue('custbody_yy_so_nositefee');
                // If discount item is 67258 or customer has 0% markup or order is picked test or subtotal is 0 or ship method is one of three values
                if (discountItem == 67258 || custentity_mb_markup == 0 || pickedTest || subtotal == 0 || shipMethod == 80326 || shipMethod == 62060 || shipMethod == 68503) {
                    // Set shipping cost to 0 if Gas Charge Override is unchecked
                    if (!gasOverride) {
                        context.newRecord.setValue('shippingcost', 0);
                    }
                    // Set Site Fee to null if Override Site Fee is unchecked
                    if (!overrideSiteFee) {
                        context.newRecord.setValue('custbody_yy_so_handlingcost', null);
                    }
                }
                // If ship method is one of six values and Override Site Fee is unchecked, set Site Fee to null
                if ((shipMethod == 68503 || shipMethod == 62060 || shipMethod == 4640 || shipMethod == 3 || shipMethod == 96032 || shipMethod == 80326) && !overrideSiteFee) {
                    context.newRecord.setValue('custbody_yy_so_handlingcost', null);
                }
                // Set native Handling Cost to Site Fee
                const siteFee = context.newRecord.getValue('custbody_yy_so_handlingcost');
                context.newRecord.setValue('handlingCost', siteFee);
            }
            // If any line on the order has both custcol_mb_so_collection set to  Alvic and custcol_fd_tls_item_group set to sample, set Do Not Print PL to checked
        }
    }
    function AHDeleteSOAfterSubmit(context) {
        try {
            const newRecord = context.newRecord;
            const deleteso = newRecord.getValue({ fieldId: 'custbody_ah_delete_so' });
            if (deleteso) {
                let mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: 'customscript_ah_deleteso_mr',
                    deploymentId: 'customdeploy_ah_deleteso_mr',
                    params: {
                        'custscript_ah_soid': newRecord.id,
                        'custscript_ah_delete_so': 'T'
                    }
                });
                let taskId = mrTask.submit();
                let soid = newRecord.id;
                let so = query.runSuiteQL({ query: `SELECT tranid FROM transaction WHERE id = ${soid}` }).asMappedResults();
                /*
                  currentRecordord.delete({ type: currentRecordord.Type.SALES_ORDER, id: soid.toString() });
                  log.audit('@AHDeleteSOAfterSubmit: so deleted', soid);
                */
                email.send({
                    author: 17644,
                    recipients: ['mgluck@cnccabinetry.com'],
                    subject: `NOTICE: Sales Order ${so[0].tranid} Was Deleted `,
                    body: 'The sales order was deleted along with all the associated work orders.'
                });
            }
        }
        catch (e) {
            log.error('@AHDeleteSOAfterSubmit: Error deleting so', e.message);
        }
    }
    // This script afterSubmit will look at the lines and if any are closed, it will then create a task of the map reduce script to clean up or notify closed lines.
    function MJPUETriggerClosedLineMR(context) {
        if (context.type != context.UserEventType.EDIT)
            return;
        let { oldRecord, newRecord } = context;
        if (!oldRecord)
            return; // TS Appease: It will always have a value in the context of edit
        var tranid = newRecord.getValue('tranid');
        try {
            let status = newRecord.getValue('status');
            let oldRecordClosedWorkOrderLines = [];
            let newRecordClosedWorkOrderLines = [];
            var oldLineCount = oldRecord.getLineCount('item');
            var newLineCount = newRecord.getLineCount('item');
            for (let line = 0; line < oldLineCount; line++) {
                let isclosed = oldRecord.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line });
                let woid = oldRecord.getSublistValue({ sublistId: 'item', fieldId: 'woid', line });
                if (isclosed && woid) {
                    oldRecordClosedWorkOrderLines.push(String(oldRecord.getSublistValue({ sublistId: 'item', fieldId: 'lineuniquekey', line })));
                }
            }
            for (let line = 0; line < newLineCount; line++) {
                let isclosed = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line });
                let woid = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'woid', line });
                if (isclosed && woid) {
                    newRecordClosedWorkOrderLines.push(String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'lineuniquekey', line })));
                }
            }
            let hasNewClosedLinesWithWorkOrders = newRecordClosedWorkOrderLines.some(line => !oldRecordClosedWorkOrderLines.includes(line));
            // AH - I commented out on 9/29/2025 because there were closed lines that must have not been triggered the first time and weren't deleting
            /* if (!hasNewClosedLinesWithWorkOrders) {
                return;
            } */
            if (!newRecordClosedWorkOrderLines.length) {
                return;
            }
            let mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: 'customscript_mr21_cleanup_closed_line_wo',
                deploymentId: 'customdeploy_mr21_cleanup_closed_line_wo',
                params: {
                    'custscript_so_int_id': newRecord.id
                }
            });
            let taskId = mrTask.submit();
        }
        catch (e) {
            log.error('error', e.message);
            email.send({
                author: 17644,
                recipients: ['ahirsch@cnccabinetry.com'],
                subject: 'Error Deleting Closed SO Lines',
                body: `Check the execution log to manually delete the sales orders. Sales Order: ${tranid}`
            });
        }
    }
    function AHAutomateTransfersAfterSubmit(context, curRecord) {
        let { newRecord, type, oldRecord } = context;
        if (type.toString() == 'delete') {
            return;
        }
        if (newRecord.getValue({ fieldId: 'custbody_ah_manual_transfers' })) {
            return;
        }
        var createddate = newRecord.getValue('createddate') || new Date();
        var tranid = newRecord.getValue('tranid');
        var approved = newRecord.getValue('orderstatus') === 'B' || type.toString() == 'approve';
        var xferdatefield = newRecord.getValue('custbody_yy_so_xferdate');
        var xferdate = new Date(String(xferdatefield));
        var xferrecord = newRecord.getValue('custbody_yy_so_to_xferrecord');
        var location = newRecord.getValue('location');
        let oldXfer;
        if (oldRecord) { //check if they just deleted an order
            oldXfer = oldRecord.getValue('custbody_yy_so_to_xferrecord');
        }
        if (!xferdatefield) {
            //log.debug('@AHAutomateTransfersAfterSubmit: Audit', 'No Transfer Date On SO: ' + tranid);
            return;
        }
        if (typeof xferdate.toString == 'function' && xferdate.toString() == 'Invalid Date') {
            //log.debug('@AHAutomateTransfersAfterSubmit: Audit', 'Invalid Date (Format) On SO: ' + tranid);
            return;
        }
        if (xferrecord) {
            //log.debug('@AHAutomateTransfersAfterSubmit: Can not create TO for ' + tranid, 'TO Already Created For This SO');
            return;
        }
        /* if (xferdate.getTime() < (new Date().getTime() - 86400000)) {
            return;
        } */
        if (location == '7') {
            return;
        }
        if (!approved) {
            return;
        }
        // let curRecord = record.load({ type: record.Type.SALES_ORDER, id: newRecord.id });
        var soshipdate = curRecord.getValue('shipdate');
        tranid = curRecord.getValue('tranid');
        let flocation = 7;
        var transferlocation = curRecord.getValue('location');
        var transfer = record.create({
            type: record.Type.TRANSFER_ORDER,
            isDynamic: true
        });
        let tsSublist = [];
        let lineCount = curRecord.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < lineCount; i++) {
            let itemType = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i }).toString();
            let isclosed = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i });
            let needsTS = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_transfernecessary', line: i });
            if (!isclosed && ['Assembly', 'Inventory', 'InvtPart'].includes(itemType) && needsTS) {
                tsSublist.push({
                    item: Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i })),
                    quantity: Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })),
                    soLineId: Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i })),
                    woid: String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'woid', line: i })) // String was used so that the value does not turn into 0 when empty.
                });
            }
        }
        transfer.setValue({ fieldId: 'subsidiary', value: 2 });
        transfer.setValue({ fieldId: 'tranid', value: `T${tranid}` });
        transfer.setValue({ fieldId: 'location', value: flocation });
        transfer.setValue({ fieldId: 'transferlocation', value: transferlocation });
        transfer.setValue({ fieldId: 'shipdate', value: xferdate });
        transfer.setValue({ fieldId: 'custbody_yy_so_xferdate', value: soshipdate });
        transfer.setValue({ fieldId: 'custbody_yy_so_to_xferrecord', value: curRecord.id });
        //log.debug('@AHAutomateTransfersAfterSubmit: tsSublist', tsSublist);
        for (let i = 0; i < tsSublist.length; i++) {
            transfer.selectNewLine({ sublistId: 'item' });
            transfer.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: tsSublist[i].item });
            transfer.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: tsSublist[i].quantity });
            transfer.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_so_line_id', value: tsSublist[i].soLineId });
            // JR - Commenting out work order related functionality as it's now being done in the WO creation script
            // if (!displayItems.includes(Number(tsSublist[i].item))) { //if the current item is a display item that there's no WO, skip adding the work order to the ts
            //   transfer.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_fd_wit_for_work_order', value: tsSublist[i].woid });
            // }
            transfer.commitLine({ sublistId: 'item' });
        }
        var rates = [];
        var items = [];
        for (var line = 0; line < transfer.getLineCount('item'); line++) {
            items.push(Number(transfer.getSublistValue({ sublistId: 'item', fieldId: 'item', line })));
            rates.push(Number(transfer.getSublistValue({ sublistId: 'item', fieldId: 'rate', line })));
        }
        try {
            var results = query.runSuiteQL({
                query: `
          SELECT
            id, itemid, custitem_yy_it_rollingaverage_saved, lastpurchaseprice, averagecost, cost
          FROM
            item
          WHERE
            id IN (${items.join()})
        `
            }).asMappedResults();
            //log.debug('@AHAutomateTransfersAfterSubmit: rate results', results);
            for (var line = 0; line < transfer.getLineCount('item'); line++) {
                var item = transfer.getSublistValue({ sublistId: 'item', fieldId: 'item', line });
                var corresponding = results.find(result => result.id == item);
                var { custitem_yy_it_rollingaverage_saved, lastpurchaseprice, averagecost, cost } = corresponding || {};
                var rate = Number(custitem_yy_it_rollingaverage_saved || lastpurchaseprice || averagecost || cost || 0.1);
                transfer.selectLine({ sublistId: 'item', line });
                transfer.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: rate });
                transfer.commitLine({ sublistId: 'item' });
            }
        }
        catch (e) { }
        let toid = transfer.save();
        log.debug('@AHAutomateTransfersAfterSubmit: toid', toid);
        let id = curRecord.id;
        // record.submitFields({ type: record.Type.SALES_ORDER, id, values: { 'custbody_yy_so_to_xferrecord': toid } });
        curRecord.setValue('custbody_yy_so_to_xferrecord', toid);
    }
    function CNCSalesOrderTariffAutomation(context, soRec) {
        // Many changes made since this was first added. Please reenter from the live file.
    }
    function getItemIdByName(name) {
        try {
            var res = search.create({
                type: search.Type.ITEM,
                filters: [['itemid', 'is', name]],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });
            return res.length > 0 ? res[0].getValue('internalid') : null;
        }
        catch (e) {
            log.error('@getItemIdByName: error', e.message);
            return null;
        }
    } // Support function for CNCUpdateErrorPlaceHolderItem
    function CNCUpdateErrorPlaceHolderItem(context) {
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT)
            return;
        try {
            var newRec = context.newRecord;
            var soId = newRec.id;
            var customerId = newRec.getValue('entity');
            if (parseInt(customerId) !== 161136) {
                return;
            }
            // Step 1: Run Saved Search Logic
            var resultMap = {};
            var results = search.create({
                type: "salesorder",
                filters: [
                    ["type", "anyof", "SalesOrd"], "AND",
                    ["name", "anyof", "161136"], "AND",
                    ["mainline", "is", "F"], "AND",
                    ["item", "anyof", "306263"], "AND", // Placeholder Item
                    ["internalidnumber", "equalto", soId], "AND",
                    [
                        ["item.custitem_yy_availableso", "is", "T"], "OR",
                        ["item.type", "anyof", "Discount", "Kit", "Markup", "NonInvtPart", "OthCharge", "Subtotal"]
                    ], "AND",
                    ["item.custitem14", "doesnotcontain", "Check transactions"], "AND",
                    ["item.isinactive", "is", "F"], "AND",
                    ["item.custitem_mb_cncproductline", "noneof", "26"], "AND",
                    ["item.custitem_mb_item_group", "noneof", "7"], "AND",
                    ["item.custitem_yy_launchdate", "notafter", "today"], "AND",
                    ["item.custitem_yy_it_priceonly", "is", "F"]
                ],
                columns: [
                    search.createColumn({ name: "custcol_boomi_edi_item_name" }),
                    search.createColumn({
                        name: "formulatext",
                        formula: "CASE " +
                            "WHEN REGEXP_LIKE({custcol_boomi_edi_item_name}, '^CW[0-9]+[LR]$') THEN " +
                            "  CASE " +
                            "    WHEN {custcol_rsm_item_tag} LIKE 'ELEGANT PLUS%' THEN 'EBP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL WHITE' THEN 'L10-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL SMOKY GREY' THEN 'L02-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL MISTY GREY' THEN 'L03-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL HARVEST' THEN 'L05-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL ESPRESSO' THEN 'L11-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
                            "    ELSE REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^CW[0-9]+') " +
                            "  END " +
                            "WHEN REGEXP_LIKE({custcol_boomi_edi_item_name}, '^[0-9]+[A-Z]$') THEN " +
                            "  CASE " +
                            "    WHEN {custcol_rsm_item_tag} LIKE 'ELEGANT PLUS%' THEN 'EBP-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL WHITE' THEN 'L10-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL SMOKY GREY' THEN 'L02-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL MISTY GREY' THEN 'L03-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL HARVEST' THEN 'L05-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL ESPRESSO' THEN 'L11-' || REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
                            "    ELSE REGEXP_SUBSTR({custcol_boomi_edi_item_name}, '^[0-9]+') " +
                            "  END " +
                            "ELSE " +
                            "  CASE " +
                            "    WHEN {custcol_rsm_item_tag} LIKE 'ELEGANT PLUS%' THEN 'EBP-' || {custcol_boomi_edi_item_name} " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL WHITE' THEN 'L10-' || {custcol_boomi_edi_item_name} " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL SMOKY GREY' THEN 'L02-' || {custcol_boomi_edi_item_name} " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL MISTY GREY' THEN 'L03-' || {custcol_boomi_edi_item_name} " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL HARVEST' THEN 'L05-' || {custcol_boomi_edi_item_name} " +
                            "    WHEN {custcol_rsm_item_tag} = 'ROYAL ESPRESSO' THEN 'L11-' || {custcol_boomi_edi_item_name} " +
                            "    ELSE {custcol_boomi_edi_item_name} " +
                            "  END " +
                            "END",
                        label: "Transformed Name"
                    })
                ]
            }).run().getRange({ start: 0, end: 100 });
            for (var i = 0; i < results.length; i++) {
                var originalName = results[i].getValue({ name: 'custcol_boomi_edi_item_name' });
                var transformedName = results[i].getValue({ name: 'formulatext' });
                if (originalName && transformedName) {
                    resultMap[String(originalName)] = transformedName;
                }
            }
            // Step 2: Load SO and update matching lines
            var rec = record.load({
                type: record.Type.SALES_ORDER,
                id: soId,
                isDynamic: true
            });
            var lineCount = rec.getLineCount({ sublistId: 'item' });
            for (var j = 0; j < lineCount; j++) {
                var itemId = rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: j });
                if (parseInt(String(itemId)) !== 306263)
                    continue;
                var ediItemName = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_boomi_edi_item_name', line: j });
                var transformedName = resultMap[String(ediItemName)];
                if (!transformedName)
                    continue;
                var newItemId = getItemIdByName(transformedName);
                if (!newItemId) {
                    log.error('@CNCUpdateErrorPlaceHolderItem: Item not found for transformed name', transformedName);
                    continue;
                }
                rec.selectLine({ sublistId: 'item', line: j });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: newItemId });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1 });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: j }) });
                rec.commitLine({ sublistId: 'item' });
            }
            rec.save();
        }
        catch (e) {
            log.error('@CNCUpdateErrorPlaceHolderItem: Script Error', e.message);
        }
    }
    function ediStatusChange(context, currentRecord) {
        if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.COPY || context.type === context.UserEventType.EDIT || context.type === context.UserEventType.XEDIT) {
            // Set EDI Status Validator to Order Approved
            currentRecord.setValue('custbody_boomi_edi_status_validator', 6);
        }
    }
    function quoteAndSOCustomizationsAfterSubmit(context, currentRecord) {
        // Set CNC Class to CNC Class - search
        const cncClassSearch = currentRecord.getValue('custbody_yy_so_class_search');
        currentRecord.setValue('custbody_yy_so_cncclass', cncClassSearch);
        // Set native Handling Cost to Site Fee
        const siteFee = currentRecord.getValue('custbody_yy_so_handlingcost');
        currentRecord.setValue('handlingCost', siteFee);
    }
    function setCabsTotalOnWO(context, currentRecord) {
        if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.COPY || context.type === context.UserEventType.EDIT || context.type === context.UserEventType.XEDIT) {
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                // Set Saved Remaining CBM to Remaining Cubic Feet on Order
                const remainingCubicFeetOnOrder = currentRecord.getValue('custbody_mb_remaining_cbm_on_ord');
                currentRecord.setValue('custbody_mb_saved_remaining_cbm', remainingCubicFeetOnOrder);
            }
            // Set Total Cabs on Order Set to Cabinets on Order
            const totalCabsOnOrderSet = currentRecord.getValue('custbody_mb_so_cabinets_on_order');
            currentRecord.setValue('custbody_mb_total_cabs_set', totalCabsOnOrderSet);
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                // Set Cabinets Remaining on SO to Cabinets Remaining
                const cabinetsRemaining = currentRecord.getValue('custbody_yy_so_cabsremaining');
                currentRecord.setValue('custbody_yy_so_cabinetsremaining', cabinetsRemaining);
                // Set Large Order to checked if Cabinets on Order >= 100 or location is 12 and Cabinets on Order >= 50, and Large Order is false
                const currentRecLocation = currentRecord.getValue('location');
                const largeOrder = currentRecord.getValue('custbody27');
                if ((totalCabsOnOrderSet >= 100 || (currentRecLocation == 12 && totalCabsOnOrderSet >= 50)) && !largeOrder) {
                    currentRecord.setValue('custbody27', true);
                }
            }
        }
    }
    function redHotRushButton(context) {
        if (context.type !== context.UserEventType.VIEW && context.type !== context.UserEventType.EDIT) {
            return;
        }
        const curRecord = context.newRecord;
        const rhr = curRecord.getValue('custbody_yy_so_redhotrush');
        const currentUser = runtime.getCurrentUser();
        if (Number(currentUser.role) === 1037 || Number(currentUser.id) === 192348 || Number(currentUser.id) === 185281) { // only run for CNC Director of Operations role (Mr. Pilchick)
            const form = context.form;
            // form.clientScriptModulePath = `SuiteScripts/cnc-inhouse-scripts/cnc-consolidated-scripts/JavaScripts/so_client_scripts_attached_to_ue.js`;
            // form.clientScriptFileId = 41261662;
            form.addButton({
                id: 'custpage_red_hot_rush_button',
                label: rhr ? '(NEW) Red Hot Rush (clicked)' : '(NEW) Red Hot Rush',
                functionName: rhr ? '' : `redHotRushClick(${Number(curRecord.id)}, ${JSON.stringify(curRecord.getValue('tranid'))}, ${Number(currentUser.id)}, ${JSON.stringify(currentUser.name)}, ${JSON.stringify(curRecord.getText('shipmethod'))})`
            });
        }
    }
    function generatePaymentLink(context) {
        const curRecord = context.newRecord;
        const websiteOrder = curRecord.getValue('custbody_rsm_created_from_q_on_web');
        const cabnetOrder = curRecord.getValue('custbody_rsm_created_from_cabnet');
        const terms = curRecord.getValue('terms'); // '7' = CIA customer
        if (!websiteOrder && !cabnetOrder && String(terms) === '7') { // if it's not a Cabnet order, and it's a CIA customer, generate  Braintree payment link
            curRecord.setValue({ fieldId: 'paymentoption', value: '513373' });
            curRecord.setValue({ fieldId: 'handlingmode', value: 'PROCESS' });
        }
    }
    function alertDoverMods(context) {
        if (runtime.executionContext !== runtime.ContextType.CSV_IMPORT) {
            return;
        }
        const rec = context.newRecord;
        const lineCount = rec.getLineCount('item');
        for (let line = 0; line < lineCount; line++) {
            const item = rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line });
            if (!item)
                continue;
            const options = getOldMods(rec, line).filter(opt => opt.fieldId !== 'custcol_ap_mod_doversoftclose' && opt.fieldId !== 'custcol_yy_mod_cutdown' && opt.fieldId !== 'custcol_yy_mod_chase' && opt.fieldId !== 'custcol_mb_so_custom_modification'); // blocks all options besides one and Base/Tall Cut To and Chase Cut and Custom Modification
            if (!options.length)
                continue;
            const style = search.lookupFields({
                type: search.Type.ITEM,
                id: item,
                columns: ['custitem_mb_item_style']
            }).custitem_mb_item_style;
            if (!style)
                continue;
            if (Number(style[0]?.value) === 32 && options.length) {
                log.audit('Dover Mods', 'Record has dover mods');
                throw new Error('Options are no longer available for Dover items. Please clear options before saving this order.');
            }
        }
    }
    function getOldMods(record, line) {
        var raw = record.getSublistValue({ sublistId: 'item', fieldId: 'options', line: line });
        if (!raw)
            return [];
        return raw
            .split('\x04')
            .map(function (opt) {
            var p = opt.split('\x03');
            return {
                fieldId: (p[0] || '').toLowerCase(),
                label: p[2] || '',
                value: p[3] || '',
                text: p[4] || ''
            };
        })
            .filter(function (opt) {
            return opt.value !== '';
        });
    }
    // https://cnccabinetry.freshdesk.com/a/tickets/15097
    function useSystemLocation(context) {
        try {
            const { newRecord, type } = context;
            const entity = Number(newRecord.getValue({ fieldId: 'entity' }));
            if (type != context.UserEventType.CREATE &&
                runtime.envType != runtime.EnvType.SANDBOX) {
                return;
            }
            if (runtime.executionContext !== runtime.ContextType.WEBSTORE &&
                entity != runtime.getCurrentUser().id &&
                runtime.envType != runtime.EnvType.SANDBOX) {
                return;
            }
            const shipstate = String(newRecord.getValue({ fieldId: 'shipstate' }) || '');
            const location = Number(newRecord.getValue({ fieldId: 'location' }));
            const shipmethod = Number(newRecord.getValue({ fieldId: 'shipmethod' }));
            if (!shipstate || !location) {
                return;
            }
            const lineCount = newRecord.getLineCount({ sublistId: 'item' });
            const items = Array.from({ length: lineCount }, (_, i) => i).map(line => ({
                item: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }),
                itemtype: String(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line })),
                quantity: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line }),
                cfg: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custbody_mb_so_cut_for_glass', line }),
                wce: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custbody_mb_con_wall_cut_down_extend', line }),
                finishedinterior: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custbody_mb_so_finished_interior', line }),
                finishedInterior: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custbody_mb_so_finished_interior', line }),
                itemtypecust: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_type', line }),
                bct: newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custbody_yy_mod_cutdown', line }),
                line
            })).filter(item => ['Assembly', 'InvtPart'].includes(item.itemtype));
            if (!items.length) {
                return;
            }
            // Per the helpdesk ticket we need to exclude ship methods like customer pick up. 
            // They claim CNC Truck should not happen for these ship states and they don't need exclusion, but I don't think I need the headache when it happens.
            if (shipmethod != 4640) {
                return;
            }
            const custrecord_yy_st_direct_ship_unavail = query.runSuiteQL({
                query: `
                SELECT custrecord_yy_st_direct_ship_unavail
                FROM customrecord_yy_stateletters
                WHERE name = '${shipstate}'
            `
            }).asMappedResults()[0]?.custrecord_yy_st_direct_ship_unavail === 'T';
            if (!custrecord_yy_st_direct_ship_unavail) {
                return;
            }
            const result = (0, cnc_functions_js_1.decideTransfer)(16, shipmethod, items, false);
            const tsNeeded = result?.tsNeeded;
            if (location != (tsNeeded ? 7 : 16)) {
                newRecord.setValue({ fieldId: 'location', value: tsNeeded ? 7 : 16 });
            }
        }
        catch (e) {
            log.error('@beforeSubmit', e.message);
        }
    }
    function beforeLoad(context) {
        if (context.newRecord.type === record.Type.SALES_ORDER) {
            // Adding the client script file to the whole ue script
            const form = context.form;
            form.clientScriptFileId = 46294837;
            FDATAUESOAssignTruckBeforeLoad(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            FDACWUECheckWOCheckboxBeforeLoad(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
            NKUEConsolidateSourcedFields(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            NKUESOAddCalendarButton(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
            //  AHDeleteSOBeforeLoad(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
            //   AH_ItemLeadTime_UEBeforeLoad(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            //   // Begin functionality which was previously in workflows
            //   clearCopiedFields(context) // *PROD VERSION OF WF AS OF 10/8/25* **BOTH TYPES**
            //   copiedFrom(context) // *PROD VERSION OF WF AS OF 10/8/25* **BOTH TYPES**
            //   quoteAndSOCustomizationsBeforeLoad(context) // *PROD VERSION OF WF AS OF 10/9/25* **BOTH TYPES**
            redHotRushButton(context);
        }
        else {
            FDATAUESOAssignTruckBeforeLoad(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            NKUEConsolidateSourcedFields(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            //   AH_ItemLeadTime_UEBeforeLoad(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            //   // Begin functionality which was previously in workflows
            //   clearCopiedFields(context) // *PROD VERSION OF WF AS OF 10/8/25* **BOTH TYPES**
            //   copiedFrom(context) // *PROD VERSION OF WF AS OF 10/8/25* **BOTH TYPES**
            //   quoteAndSOCustomizationsBeforeLoad(context) // *PROD VERSION OF WF AS OF 10/9/25* **BOTH TYPES**
        }
    }
    // --------------------------------------------------------------------------------
    // Before Submit Entry Point
    // --------------------------------------------------------------------------------
    function beforeSubmit(context) {
        // Run this function first because many of the functions use the warehouse location
        // The execution context for this function is contained within the body of the function itself
        useSystemLocation(context);
        if (context.newRecord.type === record.Type.SALES_ORDER) {
            FDACWUECheckWOCheckboxBeforeSubmit(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
            if (runtime.executionContext === runtime.ContextType.CSV_IMPORT
                || runtime.executionContext === runtime.ContextType.SUITELET
                || runtime.executionContext === runtime.ContextType.WEBSTORE) { // Restrict to CSV Import, Suitelet, Web Services, Webstore
                FDTLSUETransformAccessoriesForCSV(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            }
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                FDATAUESOAssignTruckBeforeSubmit(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
                FDABDBulkDiscount(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
                // NKSSCCSetShippingAndCountertopCost(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
                AHChangeItem(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
                /* if (context.type == context.UserEventType.CREATE) {
                    generatePaymentLink(context);
                } */
            }
            // NKUESOSetReplacementSOID(context) // *PROD VERSION OF SCRIPT AS OF 10/22/25* **SALES ORDER ONLY**
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                AHLocationChange(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
                AHAvailableStock(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
                // // // // AHAutomateTransfersBeforeSubmit(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
                alertDoverMods(context);
            }
            // FDMQBUE(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                // This function broke CIA order entry after a Braintree SuiteApp update on 4/28/2026 7:09 PM. I made it inactive as a quick fix and because I don't understand its purpose in the first place.
                // YYSetBTLinks(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
            }
            // // // // AH_ItemLeadTime_UEBeforeSubmit(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                AH_CIA_UE(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
            }
            // // Begin functionality which was previously in workflows
            // quoteAndSOCustomizationsBeforeSubmit(context) // *PROD VERSION OF WF AS OF 10/10/25* **BOTH TYPES**
        }
        else {
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                // NKSSCCSetShippingAndCountertopCost(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
                FDATAUESOAssignTruckBeforeSubmit(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            }
            if (runtime.executionContext === runtime.ContextType.CSV_IMPORT) { // Restrict to CSV Import only
                FDTLSUETransformAccessoriesForCSV(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            }
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                FDABDBulkDiscount(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            }
            // FDMQBUE(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPE
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                AHChangeItem(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
                AHAvailableStock(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
                alertDoverMods(context);
            }
            // // // // AH_ItemLeadTime_UEBeforeSubmit(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
            // // Begin functionality which was previously in workflows
            // quoteAndSOCustomizationsBeforeSubmit(context) // *PROD VERSION OF WF AS OF 10/10/25* **BOTH TYPES**
        }
    }
    function CNCUECallAsyncWorkOrders(context) {
        try {
            const { newRecord, oldRecord } = context;
            const orderstatus = newRecord.getValue('orderstatus');
            if (context.type == context.UserEventType.APPROVE || orderstatus == 'B' && oldRecord?.getValue('orderstatus') == 'A') {
                const { id } = newRecord;
                const tranid = parseInt(String(newRecord.getValue('tranid')).slice(1)) || id;
                const taskId = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: 'customscript_cnc_mr_workorder',
                    deploymentId: `customdeploy${tranid % 10}`,
                    params: {
                        'custscript_asyncworkorders_soid': id
                    }
                }).submit();
            }
        }
        catch (e) {
            log.error('@CNCUECallAsyncWorkOrders', e.message);
        }
    }
    // --------------------------------------------------------------------------------
    // After Submit Entry Point
    // --------------------------------------------------------------------------------
    function afterSubmit(context) {
        const recType = context.newRecord.type;
        // Uncomment the following line (along with the line that saves the currentRecord) when the functions that require it are made live
        // const currentRecord = record.load({ type: recType, id: context.newRecord.id, isDynamic: true });
        if (recType === record.Type.SALES_ORDER) {
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                MJPUETriggerClosedLineMR(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
                if (runtime.envType == runtime.EnvType.SANDBOX) {
                    CNCUECallAsyncWorkOrders(context);
                }
                // AHDeleteSOAfterSubmit(context); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
                // AHAutomateTransfersAfterSubmit(context, currentRecord); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
                // CNCSalesOrderTariffAutomation(context, currentRecord); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
                // CNCUpdateErrorPlaceHolderItem(context, currentRecord); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **SALES ORDER ONLY**
                // // Begin functionality which was previously in workflows
                // ediStatusChange(context, currentRecord) // *PROD VERSION OF WF AS OF 10/8/25* **SALES ORDER ONLY**
                // quoteAndSOCustomizationsAfterSubmit(context, currentRecord) // *PROD VERSION OF WF AS OF 10/10/25* **BOTH TYPES**;
            }
            // setCabsTotalOnWO(context, currentRecord) // *PROD VERSION OF WF AS OF 10/10/25* **SALES ORDER ONLY**
        }
        else {
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                // CNCSalesOrderTariffAutomation(context, currentRecord); // *PROD VERSION OF SCRIPT AS OF 9/18/25* **BOTH TYPES**
                // // Begin functionality which was previously in workflows
                // quoteAndSOCustomizationsAfterSubmit(context, currentRecord) // *PROD VERSION OF WF AS OF 10/10/25* **BOTH TYPES**
            }
        }
        // Uncomment the following line (along with the line that loads the currentRecord) when the functions that require it are made live
        // currentRecord.save()
        // We do not need to log this if it happens every time. (However we might consider checking criteria before running currentRecord.save as it costs a lot in performance)
        // log.audit('Sales Order/quote saved in afterSubmit');
    }
});
