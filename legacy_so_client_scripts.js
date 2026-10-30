define(["require", "exports", "N/record", "N/search", "N/query", "N/ui/dialog", "N/log", "N/runtime", "N/email", "SuiteScripts/cnc-inhouse-scripts/cnc-consolidated-scripts/JavaScripts/cnc-client-actions/nk_client_actions.js", "SuiteScripts/NK-Scripts/nk_ssc_set_shipping_cost"], function (require, exports, record, search, query, dialog, log, runtime, email, clientActions, setCustomCharges) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.pageInit = pageInit;
    exports.fieldChanged = fieldChanged;
    exports.postSourcing = postSourcing;
    exports.lineInit = lineInit;
    exports.validateLine = validateLine;
    exports.saveRecord = saveRecord;
    /**
    *@NApiVersion 2.1
    *@NScriptType ClientScript
    */
    var oldValues = {};
    let blackoutDateLookup = {};
    function nkLog(...args) {
        if (runtime.getCurrentUser().id == 94242)
            console.log(...arguments);
    }
    // Save the context so that we can tell if the fieldChanged 
    // function was triggered when the record was created.
    var mode = '';
    var isRecordCreate = false;
    var hasCheckedFirstItem = false;
    function setIsRecordCreate(context) {
        if (context.mode != 'create' && context.mode != 'copy' && context.mode != 'edit') {
            log.debug('@setIsRecordCreate context.mode', context.mode);
        }
        isRecordCreate = context.mode != 'edit';
    }
    const { warnCustomerShipDays, getCustomerShipDays } = (function () {
        let custdays;
        async function getCustomerShipDays(context) {
            if (!custdays) {
                custdays = await fetch("/app/site/hosting/scriptlet.nl?script=customscript_nk_sl_bad_truck_days&deploy=customdeploy_nk_sl_bad_truck_days&type=customerdays").then(r => r.json());
                warnCustomerShipDays(context);
                styleNativeCalendar(context, custdays);
            }
            return custdays;
        }
        function warnCustomerShipDays(context) {
            const { currentRecord } = context;
            const entity = String(currentRecord.getValue('entity'));
            if (!entity)
                return;
            const shipdate = new Date(String(currentRecord.getValue('shipdate')));
            if (!custdays || !custdays[entity])
                return;
            document.querySelectorAll('[data-field-name="shipdate"] *')?.forEach(el => {
                if (el.closest('#shipDatePopup'))
                    return;
                if (el instanceof HTMLSpanElement || el instanceof HTMLInputElement) {
                    console.log(el.style.backgroundColor);
                    el.style.backgroundColor = '';
                }
            });
            if (!custdays[entity].includes(shipdate.getDay())) {
                document.querySelectorAll('[data-field-name="shipdate"] *')?.forEach(el => {
                    if (el.closest('#shipDatePopup'))
                        return;
                    if (el instanceof HTMLSpanElement || el instanceof HTMLInputElement) {
                        console.log(el.style.backgroundColor);
                        el.style.backgroundColor = '#FECACA';
                    }
                });
            }
        }
        function applyStyles(context, custdays) {
            const { currentRecord } = context;
            const entity = String(currentRecord.getValue('entity'));
            if (entity && custdays[entity]) {
                const calendar = document.querySelector('#calendar');
                calendar?.querySelector('tbody > tr:nth-child(2)')?.style.setProperty('background-color', '#F3F4F6');
                const table = document.querySelector('#calendar .uir-popup-cal');
                if (!table)
                    return;
                // Remove gaps and make the whole calendar a light gray.
                table.cellPadding = '0';
                table.style.borderCollapse = 'collapse';
                table.style.backgroundColor = '#F3F4F6';
                const allowedDays = new Set(custdays[entity]);
                // Color the day-of-week header.
                table.querySelectorAll('tr:first-child td').forEach((cell, dayOfWeek) => {
                    cell.style.backgroundColor =
                        dayOfWeek === 0 || dayOfWeek === 6
                            ? '#F3F4F6'
                            : allowedDays.has(dayOfWeek)
                                ? '#DCFCE7'
                                : '#FECACA';
                    cell.style.padding = '2px';
                });
                // Color the calendar days.
                table.querySelectorAll('.uir-popup-cal-row').forEach(row => {
                    row.querySelectorAll('td').forEach((cell, dayOfWeek) => {
                        cell.style.backgroundColor =
                            dayOfWeek === 0 || dayOfWeek === 6
                                ? '#F3F4F6'
                                : allowedDays.has(dayOfWeek)
                                    ? '#DCFCE7'
                                    : '#FECACA';
                        cell.style.padding = '2px';
                    });
                });
            }
            const location = String(currentRecord.getValue('location'));
            if (blackoutDateLookup[location]) {
                document.querySelectorAll('#calendar .uir-popup-cal-row td').forEach(cell => {
                    // Extract the date string from the onclick attribute
                    const onclick = cell.querySelector('a')?.getAttribute('onclick');
                    const date = onclick?.match(/pickdate_inline\("([^"]+)"\)/)?.[1];
                    if (date && blackoutDateLookup[location].includes(date)) {
                        cell.style.backgroundColor = '#D1D5DB';
                    }
                });
            }
            // So it reapplies the styling if they click the arrows to change between months
            document.querySelectorAll('#calendar a').forEach((e, i) => {
                if (i > 1)
                    return;
                e.addEventListener('click', () => applyStyles(context, custdays));
            });
        }
        function styleNativeCalendar(context, custdays) {
            document.querySelector('#shipdate_helper_calendar')?.addEventListener('click', () => {
                applyStyles(context, custdays);
            });
        }
        return {
            getCustomerShipDays,
            warnCustomerShipDays
        };
    })();
    // Function for requiring a reason on 'Discount Damage 100%' items
    const requireDiscountReason = clientActions.requireDiscountReason;
    // Inserts a dialog prompting the user to mark down if a ship date change was requested by the customer
    var { insertShipDateDialogHidden, showShipDateDialog } = clientActions;
    var oldShipAddress;
    function setOldShipAddress(context) {
        var { currentRecord } = context;
        oldShipAddress = currentRecord.getValue('shipaddress');
    }
    // #region SetMultipleDialog
    function setMultipleLines(context) {
        var { currentRecord, fieldId } = context;
        if (fieldId != 'custbody_nk_set_multiple_lines') {
            return;
        }
        const custbody_nk_set_multiple_lines = currentRecord.getValue('custbody_nk_set_multiple_lines');
        if (!custbody_nk_set_multiple_lines) {
            return;
        }
        currentRecord.setValue({ fieldId: 'custbody_nk_set_multiple_lines', value: false });
        var modal = `
        <style>
            .modal {
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
            }
            
            /* Modal content box */
            .modal-content {
                display: flex;
                flex-direction: column;
                position: fixed;
                background-color: #fefefe;
                box-shadow: 2px 4px 6px teal;
                align-items: center; /* centered */
                border-radius: 5px;
                overflow: hidden;
                height: 40%;
                width: 80%; /* Could be more or less, depending on screen size */
            }
            
            .modal-header, .modal-submit {
                display: flex; 
                align-items: center;
            }
            
            .modal-submit {
                padding: 20px;
                justify-content: space-around;
            }
            
            .modal-header {
                width: 100%;
                display: flex;
                background-color: pink;
                justify-content: space-between;
                align-items: center;
                padding: 0 10px;
            }
            
            #set-multiple-value, #set-multiple-options {
                width: 100%;
            }
            
            .modal-select {
                display: flex;
                justify-content: space-evenly;
                align-items: center;
                flex-direction: column;
                padding: 20px;
                height: 100%;
                width: 80%;
            }

            @media (min-width: 800px) {
                .modal-content {
                    width: 25%;
                }
            }

            .close-btn {
                top: 10px;
                right: 10px;
                color: #aaa;
                float: right;
                font-size: 28px;
                font-weight: bold;
            }
            
            .modal-select input, .modal-select select {
                box-shadow: 1px 2px 6px silver;
                border-radius: 2px;
            }
            
            .modal-lines {
                width: 10%;
                border-width: 0 0 1px 0;
                text-align: center;
            }
            
            .close-btn:hover,
            .close-btn:focus {
                color: black;
                text-decoration: none;
                cursor: pointer;
            }
        </style>
        <div id="modal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <p>Set Multiple Lines</p>
                    <span class="close-btn" id="closeModalBtn">&times;</span>
                </div>
                <div class="modal-select">
                    <label>Field:</label>
                    <select id="set-multiple-options">
                        <option value="custcol_yy_mod_alviccolor">Alvic Color</option>
                        <option value="custcol_yy_mod_alvicfingerpull">Alvic Fingerpull</option>
                        <option value="custcol_yy_mod_alvicgrain">Alvic Grain</option>
                        <option value="custcol_yy_mod_blumhinges">Blum Hardware</option>
                        <option value="custcol_mb_so_custom_modification">Custom Modification</option>
                        <option value="custcol_yy_mod_edgeband">Edge Band</option>
                        <option value="custcol_yy_mod_cplus_color">Plus Paint Colors</option>
                        <option value="custcol_er_mod_cplus_stain">Plus Stain Colors</option>
                        <option value="custcol_mb_so_tag">Tag</option>
                    </select>
                    <label>Value:</label>
                    <input type="text" id="set-multiple-value" />
                    <div>
                        <label>Lines:</label>
                        <input type="number" class="modal-lines" id="modal-from-lines" />
                        <label>-</label>
                        <input type="number" class="modal-lines" id="modal-to-lines" />
                    </div>
                    <div class="modal-submit">
                        <button id="modal-submit-button">Submit</button>
                    </div>
                </div>
            </div>
        </div>
    `;
        var scriptHTML = `
        // Get the modal overlay
        var modal = document.getElementById("modal");

        // Get the <span> element that closes the modal
        var span = document.getElementById("closeModalBtn");

        // When the user clicks on <span> (x), close the modal
        span.onclick = function() {
            // console.log('close modal')
            document.getElementById('set-multiple-modal').remove();
            document.getElementById('set-multiple-script').remove();
        }

        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function(event) {
            if (event.target == modal) {
                // console.log('clicked out')
                document.getElementById('set-multiple-modal').remove();
                document.getElementById('set-multiple-script').remove();
            }
        }
    `;
        const body = document.querySelector('body');
        var div = document.createElement('div');
        var script = document.createElement('script');
        if (!body) {
            return;
        }
        div.id = 'set-multiple-modal';
        script.id = 'set-multiple-script';
        div.innerHTML = modal;
        script.innerHTML = scriptHTML;
        body.append(div);
        body.append(script);
        document.getElementById("modal-from-lines").value = '1';
        document.getElementById("modal-to-lines").value = String(nlapiGetLineItemCount('item'));
        var map = {
            custcol_yy_mod_alvicgrain: 'customlist_yy_alv_grain',
            custcol_yy_mod_cplus_color: 'customlist_yy_cplus_color',
            custcol_er_mod_cplus_stain: 'customlist_er_cplus_stain',
            custcol_yy_mod_blumhinges: 'customlist_mb_finished_interior_list',
            custcol_yy_mod_edgeband: 'customlist_mb_finished_interior_list',
            custcol_yy_mod_alvicfingerpull: 'customlist_nk_alvic_fp'
        };
        let select;
        document.getElementById('set-multiple-options').addEventListener('change', e => {
            if (!(e.target instanceof HTMLSelectElement)) {
                return;
            }
            var input = document.getElementById('set-multiple-value');
            if ([
                'custcol_yy_mod_cplus_color',
                'custcol_er_mod_cplus_stain',
                'custcol_yy_mod_alvicgrain',
                'custcol_yy_mod_edgeband',
                'custcol_yy_mod_alvicfingerpull',
                'custcol_yy_mod_blumhinges'
            ].includes(e.target.value)) {
                select = document.createElement('select');
                var clear = document.createElement('option');
                clear.value = '';
                clear.text = '';
                select.appendChild(clear);
                search.create({
                    type: map[e.target.value],
                    filters: ['isinactive', 'is', 'F'],
                    columns: ['name']
                }).run().getRange({ start: 0, end: 1000 }).forEach((result, index) => {
                    const option = document.createElement('option');
                    option.value = result.id;
                    option.text = String(result.getValue('name'));
                    select.appendChild(option);
                    if (index == 0) {
                        select.value = option.value;
                    }
                });
            }
            // For checkbox fields
            else if (['custcol_checkbox_field'].includes(e.target.value)) {
                select = document.createElement('input');
                select.type = 'checkbox';
            }
            else {
                select = document.createElement('input');
                select.type = 'text';
            }
            select.id = 'set-multiple-value';
            input.parentNode?.replaceChild(select, input);
        });
        var button = document.getElementById("modal-submit-button");
        button.onclick = setLines;
        function setLines() {
            var lineCount = nlapiGetLineItemCount('item');
            var range = [
                Number(document.getElementById('modal-from-lines').value) || 1,
                Number(document.getElementById('modal-to-lines').value) || lineCount
            ];
            var select = document.getElementById('set-multiple-options');
            var field = select.value;
            var input = document.getElementById('set-multiple-value');
            var value = input.value;
            // In case we want to add checkbox modifications
            // var value = input.value || document.getElementById('set-multiple-value').value.checked || '';
            if (input.type == 'checkbox') {
                value = input.checked ? 'T' : 'F';
            }
            console.log('set lines', range, field, value);
            for (var line = range[0]; line <= range[1]; line++) {
                nlapiSetLineItemValue('item', field, line, value);
            }
            nlapiSelectLineItem('item', Number(nlapiGetCurrentLineItemIndex('item')) == lineCount + 1 ? lineCount : lineCount + 1);
            document.getElementById('set-multiple-modal').remove();
            document.getElementById('set-multiple-script').remove();
        }
    }
    // #endregion SetMultipleDialog
    let skipValidationOnSystemSuggestion = false;
    // #region ValidateWarehouseSelection
    const { runWarehouseSuggestion } = (function (dialog, log, email, runtime) {
        async function locationDialog(currentRecord, response) {
            const buttons = [
                { label: 'Leave it', value: 0 },
                { label: 'Change it now!', value: 1 }
            ];
            const options = {
                title: 'Location Check',
                message: `🚚 ${response.suggestion} 🚚\n`,
                buttons
            };
            function success(result) {
                if (result) {
                    currentRecord.setValue({ fieldId: 'location', value: response.warehouses[0].id });
                }
                // else {
                //     var moment = Date.now();
                //     var id = currentRecord.id;
                //     var quote = currentRecord.getValue('createdfrom');
                //     var quotenumber = currentRecord.getText('createdfrom');
                //     var author = runtime.getCurrentUser().id;
                //     var user = runtime.getCurrentUser().name;
                //     var tranid = currentRecord.getValue('tranid');
                //     email.send({
                //         author,
                //         recipients: 94242,
                //         subject: 'Suggested Location Overridden',
                //         body: `
                //             <p>Sales Order: <a href="https://5387755.app.netsuite.com/app/accounting/transactions/salesord.nl?id=${id}">${tranid}</a></p>
                //             <p><a href="https://5387755.app.netsuite.com/app/accounting/transactions/estimate.nl?id=${quote}">${quotenumber}</a></p>
                //             <p>User: ${user}</p>
                //         `,
                //     });
                // }
            }
            function failure(reason) {
                console.error('@locationDialog failure', reason);
                log.error('@locationDialog failure', reason);
            }
            await dialog.create(options).then(success).catch(failure);
        }
        async function runWarehouseSuggestion(context, originals) {
            const { currentRecord } = context;
            const shipstate = currentRecord.getValue('shipstate');
            if (!shipstate) {
                return;
            }
            const response = await fetch(`/app/site/hosting/restlet.nl?script=customscript_nk_rl_ssw&deploy=1&state=${shipstate}`, {
                method: 'POST',
                body: JSON.stringify({
                    type: 'statewarehouse',
                    state: shipstate
                })
            }).then(response => response.json());
            const location = currentRecord.getValue('location');
            if (location != originals.location) {
                return;
            }
            if (response?.suggestion && !response.warehouses.map(warehouse => String(warehouse.id)).includes(String(location))) {
                await locationDialog(currentRecord, response);
            }
        }
        return { runWarehouseSuggestion };
    }(dialog, log, email, runtime));
    // #endregion ValidateWarehouseSelection
    let isStillValidating = false;
    function checkShipDateValidated(context) {
        var { currentRecord } = context;
        if (!window.skipShipDateValidation && (isStillValidating)) {
            log.audit(currentRecord.getValue('tranid'), 'Saved mid validation');
        }
        return true;
    }
    async function lateDateDialog(type, currentRecord, override, title = 'Past 5 PM', insert = '') {
        var buttons = [];
        if (type != 'leadtime') {
            buttons.push({ label: 'Go Back', value: 1 });
        }
        if (override || [15, 86815].includes(runtime.getCurrentUser().id) || runtime.getCurrentUser().role == 3) {
            buttons.push({ label: 'Manager Override', value: 0 });
        }
        var options = {
            buttons,
            title,
            message: `Not enough time to build${insert}. Did your manager approve this date`
        };
        function success(result) {
            if (result == 2) {
                //log.audit('@lateDateDialog', 'Used recommended shipdate on: ' + currentRecord.getValue('tranid'));
            }
            else if (result == 0) {
                window.allowSaveDPF = true;
                // setTimeout is used so that the dialog is not stuck on the page while saving
                setTimeout(() => {
                    document.getElementById("btn_secondarymultibutton_submitter").click();
                }, 0);
                var id = currentRecord.id;
                var quote = currentRecord.getValue('createdfrom');
                var quotenumber = currentRecord.getText('createdfrom');
                var author = runtime.getCurrentUser().id;
                var user = runtime.getCurrentUser().name;
                var tranid = currentRecord.getValue('tranid');
                var shipdate = currentRecord.getValue('shipdate');
                email.send({
                    author,
                    recipients: 94242,
                    subject: 'Manager Override Clicked',
                    body: `
                        <p>Sales Order: <a href="https://5387755.app.netsuite.com/app/accounting/transactions/salesord.nl?id=${id}">${tranid}</a></p>
                        <p><a href="https://5387755.app.netsuite.com/app/accounting/transactions/estimate.nl?id=${quote}">${quotenumber}</a></p>
                        <p>User: ${user}</p>
                        <p>Ship Date: ${shipdate}</p>
                    `,
                    // bcc: ['NKellman@cnccabinetry.com']
                });
            }
        }
        function failure(reason) {
            document.getElementById("btn_secondarymultibutton_submitter").click();
            console.error('@lateDateDialog failure', reason);
            log.error('@lateDateDialog failure', reason);
        }
        await dialog.create(options).then(success).catch(failure);
    }
    function datePastFive(context) {
        if (!window.allowSaveDPF) {
            if (!isRecordCreate)
                return true;
            var { currentRecord } = context;
            var shipdate = currentRecord.getValue('shipdate');
            var now = Date.now();
            var isPastFive = now % 86400000 > 79200000;
            var yesterday = now - 86400000;
            var twoDaysFromNow = now + 86400000 * 2;
            if (isPastFive && shipdate.getTime() > yesterday && shipdate.getTime() < twoDaysFromNow) {
                lateDateDialog('past5', currentRecord, true);
                return false;
            }
        }
        return true;
    }
    function enableAvaCalc(context) {
        var { currentRecord } = context;
        oldValues.total = currentRecord.getValue('total');
        oldValues.shipaddress = currentRecord.getValue('shipaddress');
        oldValues.shipmethod = currentRecord.getValue('shipmethod');
        oldValues.custbody_yy_so_handlingcost = currentRecord.getValue('custbody_yy_so_handlingcost');
        return true;
    }
    function disableAvaCalc(context) {
        var { currentRecord } = context;
        var total = currentRecord.getValue('total');
        var shipaddress = currentRecord.getValue('shipaddress');
        var shipmethod = currentRecord.getValue('shipmethod');
        var custbody_yy_so_handlingcost = currentRecord.getValue('custbody_yy_so_handlingcost');
        var allowAvaCalc = total != oldValues.total || shipaddress != oldValues.shipaddress || shipmethod != oldValues.shipmethod || custbody_yy_so_handlingcost != oldValues.custbody_yy_so_handlingcost;
        if (allowAvaCalc) {
            currentRecord.setValue({ fieldId: 'custbody_ava_disable_tax_calculation', value: false });
            // if (!isRecordCreate)
            //     log.audit(`Allowing AvaTax Calc ${currentRecord.getValue('tranid')}`, `Total: ${total}, Old Total: ${oldValues.total}`);
            return true;
        }
        setCustomCharges.setShippingCost(context);
        setCustomCharges.setHandlingCost(context);
        // Check difference in totals again after reapplying custom charges
        total = currentRecord.getValue('total');
        var allowAvaCalc = total != oldValues.total || setCustomCharges.clearClosedLineCost(context) || setCustomCharges.setCountertopCost(context);
        currentRecord.setValue({ fieldId: 'custbody_ava_disable_tax_calculation', value: !allowAvaCalc });
        return true;
    }
    // #region ShipDateValidation
    /*                                     ____________
     _____________________________________|            |______
    |                                     |            |      |
    |                                     |            |______|
    |            CNC Cabinetry            |       ________    |
    |                                     |      |        |   |
    |_____________________________________|______|________|___|
        O O O                  O O O       O O O           O O
    */
    async function badShipDateDialog(context, truck, suggestedDate, reasonIsBlackout, shipDateFieldDetails) {
        const { currentRecord } = context;
        const shipField = shipDateFieldDetails.fieldId == 'shipdate' ? 'Ship Date' : 'Backorder Ship Date';
        const dateString = suggestedDate.toLocaleDateString('en-US');
        const oldDate = currentRecord.getValue(shipDateFieldDetails.fieldId);
        if (!(oldDate instanceof Date)) {
            return;
        }
        const oldDateString = oldDate.toLocaleDateString('en-US');
        const day = oldDate.getDay();
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const reasonText = reasonIsBlackout ? `${oldDateString} is a Blackout Date` : `${truck.truckType} does not go out${truck.shipstate ? `to ${truck.shipstate} ` : ''} on ${daysOfWeek[day]}s`;
        const overrideMessage = truck.shipstate ? 'Ship LTL - Longer Transit Times' : 'Manager Override';
        const buttons = [
            { label: `Use ${dateString}`, value: 1 },
            { label: 'Clear ship method', value: 2 },
            { label: `Clear ${shipField.toLowerCase()}`, value: 3 },
            { label: overrideMessage, value: 0 }
        ];
        const options = {
            buttons,
            title: 'CNC Truck Delivery Dates',
            message: `🚚 Please adjust the ${shipDateFieldDetails.label} ship date, as ${reasonText} -- Next available date: ${dateString}` //  + locationObj.text + ' as per ' + reasonText + ' 🚚\n'
        };
        function success(result) {
            if (result == 1) {
                currentRecord.setValue({ fieldId: shipDateFieldDetails.fieldId, value: suggestedDate });
            }
            else if (result == 2) {
                currentRecord.setValue({ fieldId: 'shipmethod', value: '' });
            }
            else if (result == 3) {
                currentRecord.setValue({ fieldId: shipDateFieldDetails.fieldId, value: '' });
            }
        }
        dialog.create(options).then(success).catch((reason) => {
            log.error('@badShipDateDialog failure', reason);
            console.error('@badShipDateDialog failure', reason);
        });
    }
    function getSoonestValidTruckWeekday(attemptedDate, truckWeekdays, blackoutDates) {
        let dateToValidate = new Date(attemptedDate);
        for (var i = 0; i < 100; i++) {
            const dateToValidateDayOfWeek = dateToValidate.getDay();
            const dateToValidateDateString = dateToValidate.toLocaleDateString('en-US');
            if (truckWeekdays[dateToValidateDayOfWeek] && !blackoutDates.includes(dateToValidateDateString)) {
                return dateToValidate;
            }
            dateToValidate.setDate(dateToValidate.getDate() + 1);
        }
        return dateToValidate;
    }
    async function getBlackoutDates(context) {
        const { currentRecord } = context;
        const location = currentRecord.getValue('location');
        if (!location) {
            return;
        }
        return blackoutDateLookup[location] ||= await fetch(`/app/site/hosting/restlet.nl?script=2179&deploy=1&type=blackout&location=${location}`).then(response => response.json());
    }
    async function alertInvalidShipDates(context, soonestValidShipDates, validations) {
        const { buildableFirstFullyValidDateDetails, backorderFirstFullyValidDateDetails, } = soonestValidShipDates;
        const { currentRecord, fieldId } = context;
        const { blackoutDates, truckDetails } = validations;
        const shipDateFieldsToPush = [
            { label: 'Buildable', fieldId: 'shipdate', date: currentRecord.getValue('shipdate') },
            { label: 'Backordered', fieldId: 'custbody_yy_so_bodate', date: currentRecord.getValue('custbody_yy_so_bodate') },
        ];
        // Run separate validations for truck days (per each ship date field) but one for lead times
        // If editing the ship date this should only trigger for the edited ship date (helps avoid the extra third popup situation)
        for (let details of shipDateFieldsToPush) {
            if (details.date) {
                const { fieldId, date } = details;
                const { considerations, date: suggestedDate } = fieldId == 'shipdate' ? buildableFirstFullyValidDateDetails : backorderFirstFullyValidDateDetails;
                nkLog(fieldId, considerations);
                if (considerations.includes('Blackout Date')
                    || considerations.includes('Truck Day Of Week') && considerations.length == 1) {
                    const soonestValidTruckWeekday = getSoonestValidTruckWeekday(date, truckDetails.validDays, blackoutDates);
                    if (soonestValidTruckWeekday.getTime() != new Date(date).getTime()) {
                        await badShipDateDialog(context, truckDetails, suggestedDate, considerations.includes('Blackout Date'), details);
                        return;
                    }
                }
            }
        }
    }
    function getSoonestValidShipDates(context, validations, startingPoint = new Date(), backorderStartingPoint) {
        backorderStartingPoint ||= startingPoint;
        const { blackoutDates, truckDetails } = validations;
        const truckWeekdays = truckDetails.validDays;
        console.log('validations', validations);
        const soonestValidShipDates = {
            buildableFirstFullyValidDateDetails: {
                date: getSoonestValidTruckWeekday(new Date(startingPoint), truckWeekdays, blackoutDates),
                considerations: ([]
                    .concat(!truckWeekdays[new Date(startingPoint).getDay()] && ![0, 6].includes(new Date(startingPoint).getDay()) ? 'Truck Day Of Week' : [])
                    .concat(blackoutDates.includes(new Date(startingPoint).toLocaleDateString('en-US')) ? 'Blackout Date' : [])),
            },
            backorderFirstFullyValidDateDetails: {
                date: getSoonestValidTruckWeekday(new Date(backorderStartingPoint), truckWeekdays, blackoutDates),
                considerations: ([]
                    .concat(!truckWeekdays[new Date(backorderStartingPoint).getDay()] && ![0, 6].includes(new Date(backorderStartingPoint).getDay()) ? 'Truck Day Of Week' : [])
                    .concat(blackoutDates.includes(new Date(backorderStartingPoint).toLocaleDateString('en-US')) ? 'Blackout Date' : [])),
            }
        };
        nkLog('soonestValidShipDates', soonestValidShipDates, validations, startingPoint, backorderStartingPoint);
        return soonestValidShipDates;
    }
    // Caching the searched data so that the searches don't need to run every time
    const zipTruckDetailsLookup = {};
    async function getValidWeekdaysForShipMethod(context) {
        const { currentRecord } = context;
        const isLargeOrder = currentRecord.getValue('custbody27');
        const shipmethod = Number(currentRecord.getValue('shipmethod'));
        if (!isLargeOrder) {
            if (shipmethod == 119413) {
                return {
                    truckType: 'Florida Panhandle',
                    validDays: [0, 0, 0, 0, 1, 0, 0],
                    shipstate: ''
                };
            }
            else if ([16, 97162].includes(shipmethod)) {
                const zip = String(currentRecord.getValue('shipzip')).split('-')[0].padStart(5, '0');
                if (zip) {
                    const results = zipTruckDetailsLookup[zip] ||= await fetch('/app/site/hosting/restlet.nl?script=customscript_nk_rl_ssw&deploy=1&type=ziptruck&zip=' + zip)
                        .then(response => response.json());
                    const { name, truckDays, message } = results || {};
                    if (!message) {
                        return {
                            truckType: 'CNC Truck #' + name,
                            validDays: truckDays,
                            shipstate: ''
                        };
                    }
                }
            }
            else if (shipmethod == 4640) {
                const shipstate = String(currentRecord.getValue('shipstate'));
                const location = currentRecord.getValue('location');
                if (shipstate && location) {
                    const { custrecord_yy_st_strttruck, // Location of warehouse that sends the straight truck
                    truckDays } = await fetch('/app/site/hosting/restlet.nl?script=customscript_nk_rl_ssw&deploy=1&type=straighttruck&shipstate=' + shipstate).then(response => response.json()) || {};
                    if (truckDays && location == custrecord_yy_st_strttruck?.[0]?.value) {
                        return {
                            truckType: 'Common Carrier Straight Truck',
                            validDays: truckDays,
                            shipstate
                        };
                    }
                }
            }
        }
        return {
            truckType: 'N/A',
            validDays: [0, 1, 1, 1, 1, 1, 0]
        };
    }
    const prevFieldValues = {
        shipmethod: ''
    };
    async function alertOptimalShipMethod(context) {
        try {
            var { fieldId, currentRecord } = context;
            const shipmethod = currentRecord.getValue('shipmethod');
            if (fieldId == 'shipmethod' && prevFieldValues.shipmethod == shipmethod) {
                return true;
            }
            prevFieldValues[fieldId] = currentRecord.getValue(fieldId);
            if (fieldId != 'shipmethod' && fieldId != 'shipaddress' || shipmethod != '4640') {
                return true;
            }
            // TODO: Add details for which truck leaves from which warehouse and trigger this validation on location field edits
            // First recommend CNC Truck if applicable as some customers default to common carrier (as of now there is no script for the opposite recommendation)
            const shipzip = String(currentRecord.getValue('shipzip'));
            const shipaddress = currentRecord.getValue('shipaddress');
            if (!shipzip || !shipaddress) {
                return true;
            }
            const zip = shipzip.split('-')[0].padStart(5, '0');
            var results = zipTruckDetailsLookup[shipzip] ||= await fetch('/app/site/hosting/restlet.nl?script=customscript_nk_rl_ssw&deploy=1&type=ziptruck&zip=' + zip).then(response => response.json());
            nkLog('results', results);
            const { name } = results || {};
            if (results && !results.message) {
                nkLog(`There is a CNC Truck for Zip ${shipzip} ${name}`);
                async function zipHasTruckDialog(currentRecord, zip, name) {
                    var options = {
                        buttons: [
                            { label: '👍 CNC Truck', value: 1 },
                            { label: '👎 Common Carrier', value: 0 }
                        ],
                        title: 'CNC Truck Zip Codes',
                        message: `🚚 Please consider changing ship method to CNC Truck as we do deliver to zip ${zip} with truck #${name}`
                    };
                    var selection;
                    var success = function (result) {
                        selection = result;
                        if (result) {
                            currentRecord.setValue({ fieldId: 'shipmethod', value: '16' });
                        }
                    };
                    await dialog.create(options).then(success).catch(function (error) { log.error('@success @zipHasTruckDialog', error); });
                    return selection;
                }
                var selection = await zipHasTruckDialog(currentRecord, zip, name);
                if (selection == '1') {
                    // Ship method was changed to CNC Truck so this script will trigger again
                    return false;
                }
                return true; // So ship date can validate against straight truck days and lead time days
            }
        }
        catch (e) {
            console.error('@validateShipDateAgainstTruckDays', e.message);
            log.error('@validateShipDateAgainstTruckDays', e.message);
            return true;
        }
    }
    // #endregion ShipDateValidation
    function requireBackOrderShipDate(context, trigger) {
        try {
            if (window.allowSkipBackOrderDateField) {
                log.debug('Exit at point 1', 'Manual override');
                return true;
            }
            var { currentRecord } = context;
            var orderstatus = String(currentRecord.getValue('orderstatus') || '');
            var createdfrom = currentRecord.getValue('createdfrom');
            if (!createdfrom || ['C', 'F', 'G', 'H'].includes(orderstatus)) {
                // log.debug('Exit at point 2', 'Wrong status');
                return true;
            }
            var lineCount = currentRecord.getLineCount('item');
            if (trigger == 'pageInit' && !lineCount) {
                // log.debug('Exit at point 3', 'Loaded without lines');
                return;
            }
            var isShipAvailable = currentRecord.getValue('custbody_yy_so_shippref') == '2';
            var custbody_yy_so_bodate = currentRecord.getValue('custbody_yy_so_bodate');
            var hasBuildableLines;
            var hasBackOrderedLines;
            // Work around for getting the buildable information for sales orders created from quotes as the buildable line fields are cleared in a workflow
            if (mode == 'copy' && createdfrom) {
                // For now leave out the edge case of copied orders as the buildable info is cleared and even if it wasn't you can't really on the original sales orders to be accurate (as it does not update once shipped based on status)
                if (currentRecord.getValue('transform') != 'estimate') {
                    log.debug('Exit at point 4', 'Copied sales order');
                    return true;
                }
                try {
                    var { original_buildables } = JSON.parse(String(currentRecord.getValue('custbody_nk_json')));
                    if (!original_buildables || !original_buildables.length) {
                        log.debug('Exit at point 5', '');
                        return true;
                    }
                    hasBuildableLines = original_buildables.some(line => line);
                    hasBackOrderedLines = original_buildables.some(line => !line);
                    // Potential edge case of creating a buildable sales order from a quote and adding a single backordered item
                }
                catch (e) {
                    log.error('Exit at point 6', 'Caught error');
                    return true;
                }
            }
            else {
                for (var line = 0; line < lineCount; line++) {
                    var itemtype = String(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line }) || '');
                    if (['Assembly', 'InvtPart'].includes(itemtype)) {
                        var custcol_mb_buildable = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_buildable', line });
                        var quantity = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line }) || 0);
                        var quantitycommitted = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantitycommitted', line }) || 0);
                        var quantityfulfilled = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantityfulfilled', line }) || 0);
                        var remaining = quantity - quantityfulfilled - quantitycommitted;
                        hasBackOrderedLines ||= !custcol_mb_buildable && remaining;
                        hasBuildableLines ||= custcol_mb_buildable || !remaining;
                        if (hasBackOrderedLines && hasBuildableLines) {
                            break;
                        }
                    }
                }
            }
            // If all lines are backordered then we only need the regular ship date which should have the backordered lead time
            if (hasBuildableLines && hasBackOrderedLines && isShipAvailable && !custbody_yy_so_bodate) {
                var backOrderDateField = currentRecord.getField({
                    fieldId: 'custbody_yy_so_bodate'
                });
                if (!backOrderDateField) {
                    return true;
                }
                log.debug('backOrderDateField.isMandatory', backOrderDateField.isMandatory);
                // Fields set as mandatory in client scripts do not block the save by themselves
                // if (!backOrderDateField.isMandatory)
                backOrderDateField.isMandatory = true;
                if (trigger == 'saveRecord') {
                    log.debug('Block save', '');
                    alert('Please enter a value for: ' + backOrderDateField.label);
                    return false;
                }
            }
            return true;
        }
        catch (e) {
            log.error('@requireBackOrderShipDate', e.message);
            return true;
        }
    }
    let oldShipDate;
    function pageInit(context) {
        try {
            (async function () {
                blackoutDateLookup = await fetch(`/app/site/hosting/restlet.nl?script=2179&deploy=1&type=blackoutlocations`, {
                    method: 'POST',
                    body: JSON.stringify({
                        type: 'blackoutlocations'
                    })
                }).then(response => response.json());
            })();
            mode = context.mode;
            const { currentRecord } = context;
            setIsRecordCreate(context);
            oldShipDate = currentRecord.getValue('shipdate');
            setOldShipAddress(context);
            enableAvaCalc(context);
            requireBackOrderShipDate(context, 'pageInit');
            if (currentRecord.type === record.Type.SALES_ORDER) {
                insertShipDateDialogHidden(context);
                getCustomerShipDays(context);
            }
        }
        catch (e) {
            console.error('@pageInit', e.message);
            log.error('@pageInit', e.message);
        }
    }
    var fieldChangedCount = 0;
    var time = Date.now();
    var itemSublistFieldChangesPending = [];
    function fieldChanged(context) {
        try {
            if (window.skipFieldChangedActions) {
                return;
            }
            const { currentRecord, fieldId } = context;
            if (runtime.getCurrentUser().id == 94242) {
                console.log({
                    entry: 'fieldChanged',
                    fieldId: context.fieldId,
                    newFieldValue: nlapiGetFieldValue(context.fieldId),
                    fieldChangedCount: ++fieldChangedCount,
                    lapse: (Date.now() - time),
                    nlapiGetCurrentLineItemIndex: nlapiGetCurrentLineItemIndex('item'),
                    context
                });
                time = Date.now();
            }
            if (context.sublistId == 'item') {
                itemSublistFieldChangesPending.push(context.fieldId);
                // if (isRecordCreate && !hasCheckedFirstItem && fieldId == 'item') {
                //     const item = currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' });
                //     if (item) {
                //         hasCheckedFirstItem = true;
                //         (async function () {
                //             const lineItem = {
                //                 item,
                //                 itemtype: currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'itemtype' }),
                //                 quantity: currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' }),
                //                 cfg: currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custbody_cfg' }),
                //                 wce: currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custbody_wce' }),
                //                 finishedinterior: currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custbody_finishedinterior' }),
                //                 itemtypecust: currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custbody_itemtypecust' }),
                //                 bct: currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custbody_bct' }),
                //                 line: currentRecord.getCurrentSublistIndex({ sublistId: 'item' })
                //             };
                //             // TODO: send [lineItem] to the RESTlet's direct-ship-unavailable branch
                //             nkLog('@fieldChanged first item added', lineItem);
                //         })();
                //     }
                // }
                try {
                    if (context.sublistId == 'item') {
                        const entity = currentRecord.getValue('entity');
                        const entityname = String(currentRecord.getText('entity'));
                        if (['quantity', 'price_display'].includes(fieldId) && (entity == 3527 || entity == 150654 || entityname.startsWith('LPS :'))) {
                            const item = currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' });
                            if (item) {
                                const quantity = currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' });
                                const price_display = currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'price_display' });
                                console.warn(item, quantity, price_display);
                                const { custitem_yy_it_lpsprice } = search.lookupFields({ type: 'item', id: item, columns: ['custitem_yy_it_lpsprice'] }) || {};
                                if (custitem_yy_it_lpsprice && price_display != 'Custom' && Number(price_display)) {
                                    currentRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: Math.round(Number(custitem_yy_it_lpsprice) * Number(price_display) * 0.0001 * 100) / 100 });
                                }
                            }
                        }
                    }
                }
                catch (e) {
                    console.error(e);
                }
            }
            showShipDateDialog(context);
            setMultipleLines(context);
            if (skipValidationOnSystemSuggestion) {
                skipValidationOnSystemSuggestion = false;
                return;
            }
            // Can avoid calling the async function if a field that does not need validation is changed
            if (!['location', 'shipaddress', 'shipmethod', 'shipdate', 'custbody_yy_so_bodate'].includes(fieldId)) {
                return;
            }
            // To accommodate for a NetSuite bug where a redundant fieldChanged triggers when changing ship address
            if (fieldId == 'shipaddress') {
                // Check that shipaddress was actually changed
                if (currentRecord.getValue('shipaddress') == oldShipAddress) {
                    return; // Validations need not continue
                }
                setOldShipAddress(context);
            }
            const originals = {
                location: currentRecord.getValue('location')
            };
            (async function () {
                isStillValidating = true;
                const blackoutDatesPending = getBlackoutDates(context);
                const truckWeekdaysPending = getValidWeekdaysForShipMethod(context);
                // Highlight the ship date if it doesn't match the customers date
                warnCustomerShipDays(context);
                // Find closest warehouse if it can deliver these items
                const shipstate = currentRecord.getValue({ fieldId: 'shipstate' });
                if (shipstate && ['location', 'shipaddress'].includes(fieldId)) {
                    await runWarehouseSuggestion(context, originals);
                }
                const shipmethod = currentRecord.getValue('shipmethod');
                let location = currentRecord.getValue('location');
                if (location == originals.location &&
                    ['location', 'shipmethod', 'shipaddress'].includes(fieldId)
                    && shipmethod == 4640) {
                    await alertOptimalShipMethod(context);
                }
                if (currentRecord.getValue('type') != 'salesord') {
                    isStillValidating = false;
                    return;
                }
                const blackoutDates = await blackoutDatesPending;
                const truckDetails = await truckWeekdaysPending;
                nkLog(blackoutDates, truckDetails);
                const shipdate = new Date(String(currentRecord.getValue('shipdate')));
                const custbody_yy_so_bodate = currentRecord.getValue('custbody_yy_so_bodate');
                const shipAvailable = currentRecord.getValue('custbody_yy_so_shippref') == 2;
                const soonestValidShipDates = getSoonestValidShipDates(context, { blackoutDates, truckDetails }, shipdate, shipAvailable && custbody_yy_so_bodate);
                // TODO: Have this popup run when new item collections are added to the order
                await alertInvalidShipDates(context, soonestValidShipDates, { blackoutDates, truckDetails });
                isStillValidating = false;
            }());
        }
        catch (e) {
            isStillValidating = false;
            console.error('@fieldChanged', e.message);
            log.error('@fieldChanged', e.message);
        }
    }
    function checkForAItems(context) {
        let curRecord = context.currentRecord;
        let lineCount = curRecord.getLineCount({ sublistId: 'item' });
        let shipdate = new Date(curRecord.getValue({ fieldId: 'shipdate' }));
        let today = new Date();
        let orderstatus = curRecord.getValue({ fieldId: 'orderstatus' });
        let aItem;
        if ((shipdate < today) || !(orderstatus === 'A' || orderstatus === 'B')) { //if the date is in the past don't prevent save or it's not pending approval or pending fulfillment
            return true;
        }
        for (let i = 0; i < lineCount; i++) {
            let collection = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: i });
            let itemName = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item_display', line: i });
            let woid = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'woid', line: i });
            if (woid) {
                continue;
            }
            if (collection == 11 && itemName.startsWith('A')) {
                aItem = true;
                alert('There are A-items on this order. Please change them and save again.');
                return false;
            }
        }
        return true;
    }
    function postSourcing(context) {
        try {
            if (context.sublistId == 'item') {
                const { currentRecord, fieldId } = context;
                const entity = currentRecord.getValue('entity');
                const entityname = String(currentRecord.getText('entity'));
                if (['item', 'quantity', 'price_display'].includes(fieldId) && (entity == 3527 || entity == 150654 || entityname.startsWith('LPS :'))) {
                    const item = currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' });
                    if (item) {
                        const quantity = currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' });
                        const price_display = currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'price_display' });
                        console.warn(item, quantity, price_display);
                        const { custitem_yy_it_lpsprice } = search.lookupFields({ type: 'item', id: item, columns: ['custitem_yy_it_lpsprice'] }) || {};
                        if (custitem_yy_it_lpsprice && price_display != 'Custom' && Number(price_display)) {
                            currentRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: Math.round(Number(custitem_yy_it_lpsprice) * price_display * 0.0001 * 100) / 100 });
                        }
                    }
                }
            }
        }
        catch (e) {
            console.error(e);
        }
    }
    function lineInit(context) {
        const { sublistId } = context;
        nkLog(context);
        if (sublistId == 'item' && runtime.getCurrentUser().id == 94242) {
            itemSublistFieldChangesPending = [];
        }
    }
    function validateLine(context) {
        try {
            const { currentRecord, currentRecord: { id }, sublistId } = context;
            const orderstatus = currentRecord.getValue('orderstatus');
            const createddate = new Date(String(currentRecord.getValue('createddate')));
            const custcol_mb_so_collection = currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection' });
            if (id &&
                // Exclude individual orders by ID.
                id != 67793133 && id != 71015156 &&
                currentRecord.type === record.Type.SALES_ORDER &&
                orderstatus != 'A' &&
                sublistId == 'item' &&
                [1, 2, 19].includes(Number(custcol_mb_so_collection)) && (
            // runtime.getCurrentUser().id == 94242 ||
            createddate.getTime() >= new Date('6/16/2025').getTime() &&
                runtime.getCurrentUser().role != 3) &&
                runtime.getCurrentUser().role != 1009 &&
                ![86815, 15].includes(Number(runtime.getCurrentUser().id))) {
                const status = currentRecord.getValue('status');
                let custbody_nk_approval_date = String(currentRecord.getValue({ fieldId: 'custbody_nk_approval_date' }));
                if (!custbody_nk_approval_date) {
                    var results = query.runSuiteQL({
                        query: `
                        SELECT 
                            TO_CHAR(date, 'DS TS') as date
                        FROM 
                            systemnote
                        WHERE recordtypeid = -30
                        AND recordid = ${id}
                        AND field = 'TRANDOC.KSTATUS'
                        AND newvalue = 'Pending Fulfillment'
                        ORDER BY
                            id
                    `
                    }).asMappedResults()[0]?.date || currentRecord.getValue('createddate');
                    currentRecord.setValue({ fieldId: 'custbody_nk_approval_date', value: String(results) });
                    custbody_nk_approval_date = String(results);
                }
                const approvalDate = new Date(custbody_nk_approval_date);
                const approvalDateString = approvalDate.toLocaleDateString();
                approvalDate.setDate(approvalDate.getDate() + 2 + ([4, 5].includes(approvalDate.getDay()) ? 2 : (approvalDate.getDay() === 6 ? 1 : 0)));
                console.log(approvalDate);
                if (approvalDate < new Date()) {
                    console.log('@validateLine', { context, createddate, itemSublistFieldChangesPending, status, orderstatus, id });
                    const isclosed = currentRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'isclosed' });
                    if (itemSublistFieldChangesPending.some(change => change != 'isclosed') || !isclosed) {
                        alert(`Cannot change item line details for 2 day old Con/Cls orders.\nApproval date: ${approvalDateString}`);
                        return false;
                    }
                }
            }
            return true;
        }
        catch (e) {
            return true;
        }
    }
    function saveRecord(context) {
        try {
            var userId = runtime.getCurrentUser().id;
            // Do not run this logic for this user
            if (userId == 144846) {
                return true;
            }
            var currentRecord = context.currentRecord;
            // TODO: Block the save if the ship date is still validating so that we can validate ship dates asynchronously
            if (currentRecord.type === record.Type.SALES_ORDER) {
                return (requireBackOrderShipDate(context, 'saveRecord') &&
                    requireDiscountReason(currentRecord) &&
                    datePastFive(context) &&
                    disableAvaCalc(context) &&
                    checkShipDateValidated(context) &&
                    checkForAItems(context));
            }
            return true;
        }
        catch (e) {
            console.error('@saveRecord', e.message);
            log.error('@saveRecord', e.message);
            return true;
        }
    }
});
