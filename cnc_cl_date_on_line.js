define(["require", "exports", "../../cnc_functions.js", "./total_days_to_push", "./prod_days_before_ship", "N/runtime", "N/log", "N/record", "N/query", "N/ui/dialog"], function (require, exports, cnc_functions_js_1, total_days_to_push_1, prod_days_before_ship_1, runtime, log, record, query, dialog) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.pageInit = pageInit;
    exports.validateLine = validateLine;
    exports.saveRecord = saveRecord;
    exports.fieldChanged = fieldChanged;
    exports.populateLeadTimes = populateLeadTimes;
    exports.validateShipDate = validateShipDate;
    exports.checkShipDate = checkShipDate;
    /**
     * @NApiVersion 2.1
     * @NScriptType ClientScript
     * @Author Ariella Hirsch
     * Put the new lead time information on the line for each item and prevent save if the shipdate is greater than the leadtimes
     */
    let oldShipDate;
    let oldboshipdate;
    let oldxferdate;
    //They have a set lead time depending on collection and don't want any interference with it.
    const leadTimeExemptCustomers = []; //[161136]; //THEHD
    function pageInit(context) {
        const curRecord = context.currentRecord;
        oldShipDate = new Date(String(curRecord.getValue({ fieldId: 'shipdate' })));
        oldboshipdate = new Date(String(curRecord.getValue({ fieldId: 'custbody_yy_so_bodate' })));
        oldxferdate = new Date(String(curRecord.getValue({ fieldId: 'custbody_yy_so_xferdate' })));
        const customer = Number(curRecord.getValue({ fieldId: 'entity' }));
        if (leadTimeExemptCustomers.includes(customer)) {
            return;
        }
        const status = curRecord.getValue({ fieldId: 'orderstatus' });
        if (curRecord.type === record.Type.SALES_ORDER && status !== 'A') {
            return;
        }
        const lineCount = curRecord.getLineCount({ sublistId: 'item' });
        if (lineCount === 0) {
            return;
        }
        const itemTypes = [];
        for (let line = 0; line < lineCount; line++) {
            const itemtype = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line }));
            itemTypes.push(itemtype);
        }
        if (!itemTypes.includes('Assembly') && !itemTypes.includes('InvtPart')) {
            return true;
        }
        const lines = Array.from({ length: lineCount }, (_, i) => i);
        populateLeadTimes(curRecord, lines);
        //#region Fill Out ship date
        // For starters automate the ship date only when sales orders are created via quotes
        const { mode } = context;
        const createdfrom = curRecord.getValue({ fieldId: 'createdfrom' });
        const lineLeadTimeFullDetails = Array.from({ length: curRecord.getLineCount('item') }, (_, i) => i).map(line => ({ lineLeadTime: String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_lead_time', line })) })).filter(val => val.lineLeadTime);
        // An array with a length of 7 to represent valid weekdays for shipping
        let truckDays = [false, true, true, true, true, true, false];
        const shipmethod = curRecord.getValue({ fieldId: 'shipmethod' });
        if (shipmethod == '119413') {
            truckDays = [false, false, false, false, true, false, false];
        } // FL Panhandle ships Thursdays
        else if (shipmethod == '16') {
            const zip = String(curRecord.getValue('shipzip'));
            truckDays = getZipWeekdays(zip).truckDays;
        }
        if ((createdfrom && ['create', 'copy'].includes(mode))) {
            // TODO: Take truck days into account and then check shipping capacity
            const shipAvailable = curRecord.getValue({ fieldId: 'custbody_yy_so_shippref' }) == 2;
            const lineLeadTimes = lineLeadTimeFullDetails.map(line => new Date(line.lineLeadTime)).sort((a, b) => a.getTime() - b.getTime());
            if (!lineLeadTimes.length) {
                return;
            }
            const earliestLeadTime = lineLeadTimes[0];
            const latestLeadTime = lineLeadTimes[lineLeadTimes.length - 1];
            // Consider caching the shipping capacities in case we need to get information for the same day twice for the two different ship dates
            for (let i = 0; i < 100; i++) {
                // TODO: Check for blackout dates but instead of querying it again it should get returned from the bySoLine functions - YNK 7/17/2025
                if (truckDays[earliestLeadTime.getDay()]) {
                    // Separate if statement to record a variable for the debugger
                    // const shipAvailability = availableShippingSpace(curRecord, earliestLeadTime);
                    const shipAvailability = true; // Temporary while troubleshooting
                    if (shipAvailability) {
                        break;
                    }
                }
                earliestLeadTime.setDate(earliestLeadTime.getDate() + 1);
            }
            for (let i = 0; i < 100; i++) {
                // TODO: Check for blackout dates but instead of querying it again it should get returned from the bySoLine functions - YNK 7/17/2025
                if (truckDays[latestLeadTime.getDay()] /* && availableShippingSpace(curRecord, latestLeadTime)*/) {
                    break;
                }
                latestLeadTime.setDate(latestLeadTime.getDate() + 1);
            }
            // The main lead time data tracks when an item will be ready to ship.
            // The truck may still reject the cabinet because the trucks have a mind of their own (their own capacity and weekdays)
            console.log(lineLeadTimes);
            if (shipAvailable) {
                curRecord.setValue({ fieldId: 'shipdate', value: earliestLeadTime });
                curRecord.setValue({ fieldId: 'custbody_yy_so_bodate', value: latestLeadTime });
            }
            else {
                curRecord.setValue({ fieldId: 'shipdate', value: latestLeadTime });
            }
        }
        //#endregion
    }
    ;
    var validating = false;
    let shipDateOverrideConfirmed = false;
    function validateLine(context) {
        const curRecord = context.currentRecord;
        validateRush(curRecord);
        const status = curRecord.getValue({ fieldId: 'orderstatus' });
        const tranid = curRecord.getValue({ fieldId: 'tranid' });
        const replacement = curRecord.getValue({ fieldId: 'custbody_yy_so_replacement' });
        console.log('creation needs lt', tranid === 'To Be Generated');
        //we want lead times to generate on orders not generated from quotes many times they are put into pending fulfillment right away
        //Potential Issue: if there are 2 lines with the same item and only together will there not be enough stock, each line individually will think there is enough stock Ellie said this is very unlikely to come up and we shouldn't deal with it 11/11/2025
        //This may give conflicting lead times when saving the sales order (then it will take all the lines into account)
        if ((curRecord.type === record.Type.SALES_ORDER && status !== 'A') && tranid !== 'To Be Generated') {
            return true;
        }
        const customer = Number(curRecord.getValue({ fieldId: 'entity' }));
        if (leadTimeExemptCustomers.includes(customer)) {
            return true;
        }
        const sublistId = context.sublistId;
        try {
            if (sublistId === 'item') {
                const line = curRecord.getCurrentSublistIndex({ sublistId: sublistId });
                const itemtype = String(curRecord.getCurrentSublistValue({ sublistId: 'item', fieldId: 'itemtype' }));
                const lineCount = curRecord.getLineCount({ sublistId: 'item' });
                console.log('item type', itemtype);
                let itemtypes = ['Assembly', 'Inventory', 'InvtPart'];
                console.log(itemtypes.includes(itemtype) && !validating);
                if (itemtypes.includes(itemtype) && !validating) {
                    validating = true;
                    setTimeout(() => {
                        //get information needed for leadtime
                        if (tranid === 'To Be Generated' && lineCount > 0) {
                            populateLeadTimes(curRecord, Array.from({ length: lineCount }, (_, i) => i));
                        }
                        else {
                            populateLeadTimes(curRecord, [line]);
                        }
                        setTimeout(() => {
                            validating = false;
                        }, 2000);
                    }, 0);
                }
            }
        }
        catch (e) {
            log.error('Error at lt', 'message: ' + e.message + ' stack: ' + e.stack);
        }
        return true;
    }
    ;
    function saveRecord(context) {
        const curRecord = context.currentRecord;
        if (curRecord.type === record.Type.ESTIMATE) {
            return true;
        }
        const customer = Number(curRecord.getValue({ fieldId: 'entity' }));
        if (leadTimeExemptCustomers.includes(customer)) {
            return true;
        }
        //user already confirmed the override in the dialog, let the re-triggered save through
        if (shipDateOverrideConfirmed) {
            shipDateOverrideConfirmed = false;
            return true;
        }
        const status = validateShipDate(curRecord, true, oldShipDate, oldboshipdate, oldxferdate);
        if (status && status.reload) {
            return false;
        }
        if (status && status.error) {
            //dialog.create is async so saveRecord can't wait on it - block this save and re-submit once they answer
            function success(result) {
                if (result !== 'T') {
                    return;
                }
                curRecord.setValue({ fieldId: 'custbody_ah_override_shipdate', value: true });
                shipDateOverrideConfirmed = true;
                const saveButton = (document.getElementById('submitter') || document.getElementById('btn_multibutton_submitter'));
                if (saveButton) {
                    saveButton.click();
                }
                else {
                    shipDateOverrideConfirmed = false;
                    alert('Override ship date was set. Please click Save again.');
                }
            }
            dialog.create({
                title: 'Ship Date Validation Failed',
                message: status.message + '\n\nDo you want to proceed with your chosen date anyway?',
                buttons: [
                    {
                        label: 'Yes',
                        value: 'T'
                    },
                    {
                        label: 'No',
                        value: 'F'
                    }
                ]
            }).then(success);
            return false;
        }
        return true;
    }
    ;
    function fieldChanged(context) {
        const curRecord = context.currentRecord;
        let customer = Number(curRecord.getValue({ fieldId: 'entity' }));
        /*  if (customer !== 3527) {
            return true;
        }  */
        if (leadTimeExemptCustomers.includes(customer)) {
            return;
        }
        const status = String(curRecord.getValue({ fieldId: 'orderstatus' }));
        if (curRecord.type === record.Type.SALES_ORDER && status !== 'A' && context.fieldId === 'shipdate') {
            let newShipDate = new Date(String(curRecord.getValue({ fieldId: 'shipdate' })));
            const managerRush = curRecord.getValue({ fieldId: 'custbody_ah_override_shipdate' });
            let proddates = false;
            const lineCount = curRecord.getLineCount({ sublistId: 'item' });
            for (let i = 0; i < lineCount; i++) {
                let proddate = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_so_proddate', line: i });
                if (proddate) {
                    proddates = true;
                    break;
                }
            }
            if (newShipDate < oldShipDate) {
                if (proddates && !managerRush) {
                    alert('This order has production dates. Ship date can not be moved up.');
                }
                else {
                    populateLeadTimes(curRecord, Array.from({ length: lineCount }, (_, i) => i));
                }
            }
        }
        const lineCount = curRecord.getLineCount({ sublistId: 'item' });
        if (lineCount === 0) {
            return;
        }
        if (['B', 'A'].includes(status) && context.fieldId === 'location') {
            const lines = Array.from({ length: lineCount }, (_, i) => i);
            populateLeadTimes(curRecord, lines);
        }
        if (curRecord.type === record.Type.SALES_ORDER && status !== 'A') {
            return;
        }
        if (context.fieldId === 'custbody_mb_so_add_on_accessories') {
            const wantsrush = curRecord.getValue({ fieldId: 'custbody_mb_so_add_on_accessories' });
            //only run if they want to rush, it gave rush lead time automatically when it unchecked because it was a change and the criteria was valid
            if (wantsrush) {
                const isValidRush = validateRush(curRecord);
                if (!isValidRush) {
                    alert('Rushes are limited to add-on/replacement orders with a maximum of 3 cabinets and 5 accessories.');
                }
                else {
                    // Update all lines from/to the rush lead times
                    const lineCount = curRecord.getLineCount({ sublistId: 'item' });
                    const lines = Array.from({ length: lineCount }, (_, i) => i);
                    populateLeadTimes(curRecord, lines, true);
                }
            }
        }
    }
    ;
    function getZipWeekdays(zip) {
        zip = zip.split('-')[0].padStart(5, '0');
        const allTruckDays = query.runSuiteQL({
            query: `
            SELECT
                custrecord_cssd_monday as monday,
                custrecord_cssd_tuesday as tuesday,
                custrecord_cssd_wednesday as wednesday,
                custrecord_cssd_thursday as thursday,
                custrecord_cssd_friday as friday
            FROM customrecord_fd_ata_truck
            JOIN customrecord_fd_ata_zipcode
                ON customrecord_fd_ata_truck.id = customrecord_fd_ata_zipcode.custrecord_ata_truck
            WHERE custrecord_ata_zipcode = '${zip || ''}'
            `
        }).asMappedResults();
        // Pretend all ship dates days of week work if no truck found for the zip code as the original script (FD ATA UE SO Assign Truck) automatically changes it to common carrier
        if (!allTruckDays.length) {
            return { truckDays: [false, true, true, true, true, true, false] };
        }
        const { monday, tuesday, wednesday, thursday, friday } = allTruckDays[0];
        // Can later add a truck number key if used for popup displays
        return {
            truckDays: [
                false,
                monday === 'T',
                tuesday === 'T',
                wednesday === 'T',
                thursday === 'T',
                friday === 'T',
                false,
            ]
        };
    }
    function populateLeadTimes(curRecord, lines, rushed = false) {
        const location = Number(curRecord.getValue({ fieldId: 'location' }));
        const shipmethod = String(curRecord.getValue({ fieldId: 'shipmethod' }));
        const itemtypes = ['Assembly', 'Inventory', 'InvtPart'];
        const rush = !!curRecord.getValue({ fieldId: 'custbody_mb_so_add_on_accessories' }) || rushed;
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
            const isClosed = !!curRecord.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line });
            if (itemtypes.includes(itemtype) && !isClosed) {
                let hasMods = false;
                const item = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }));
                const quantity = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line }));
                const uom = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_uom', line }));
                let mods = Object.keys(modifications).reduce((acc, val) => {
                    let modifications;
                    // SS2 does not work for modifications in client script
                    //@ts-ignore
                    if (nlapiGetLineItemValue) {
                        //@ts-ignore
                        modifications = nlapiGetLineItemValue('item', val, line + 1);
                    }
                    // nlapiGetLineItemValue does not work in SS2
                    else {
                        modifications = curRecord.getSublistValue({ sublistId: 'item', fieldId: val, line: line });
                    }
                    //const option = nlapiGetLineItemValue('item', val, line + 1);
                    if (modifications) {
                        acc[val] = modifications;
                        hasMods = true;
                    }
                    return acc;
                }, {});
                ltInfo.push({ item, quantity, location, shipmethod, rush, mods, line, uom, hasMods });
            }
        }
        let transferdateField = curRecord.getValue({ fieldId: 'custbody_yy_so_xferdate' });
        let transferdate;
        /* if (transferdateField) {
            transferdate = new Date(transferdateField);
        } */
        const leadTimeDict = (0, cnc_functions_js_1.getLeadTime)(ltInfo);
        let showAlert = false;
        let changeToNJ = false;
        for (const item of ltInfo) {
            if (leadTimeDict[item.item].nolt) {
                showAlert = true;
                continue;
            }
            if (leadTimeDict[item.item].changeToNJ) {
                changeToNJ = true;
            }
            if (item.hasMods && leadTimeDict[item.item].modshipdate) {
                //@ts-ignore
                nlapiSetLineItemValue('item', 'custcol_ah_item_lead_time', item.line + 1, leadTimeDict[item.item].modshipdate);
            }
            else {
                //@ts-ignore
                nlapiSetLineItemValue('item', 'custcol_ah_item_lead_time', item.line + 1, leadTimeDict[item.item].shipdate);
            }
            //@ts-ignore
            nlapiSetLineItemValue('item', 'custcol_ah_line_fudged', item.line + 1, leadTimeDict[item.item].fudged ? 'T' : 'F');
            if (String(runtime.getCurrentUser().id) === '156044') {
                console.log('fudged? ', leadTimeDict[item.item].fudged);
                console.log('stdlt: ', leadTimeDict[item.item].stdlt);
            }
            if (leadTimeDict[item.item].modTransferDate && !transferdate || leadTimeDict[item.item].modTransferDate && leadTimeDict[item.item].modTransferDate > transferdate) {
                transferdate = leadTimeDict[item.item].modTransferDate;
            }
            else if (leadTimeDict[item.item].transferDate && !transferdate || leadTimeDict[item.item].transferDate && leadTimeDict[item.item].transferDate > transferdate) {
                transferdate = leadTimeDict[item.item].transferDate;
            }
        }
        if (transferdate && curRecord.type === record.Type.SALES_ORDER) {
            curRecord.setValue({ fieldId: 'custbody_yy_so_xferdate', value: transferdate });
            log.audit('transfer date set', transferdate.toLocaleDateString() + curRecord.getValue({ fieldId: 'tranid' }));
        }
        if (showAlert) {
            alert('There are items on this order that do not have lead times.');
        }
        if (changeToNJ) {
            alert('This order will be switched to NJ because of the ship method, therefore, the lead times reflect that change.');
        }
        //@ts-ignore
        nlapiRecalc('item');
        // For displaying a lead time popup
        return leadTimeDict;
    }
    ;
    function validateRush(curRecord) {
        // Uncheck "Add-On Rush" if the orders violates the criteria specified on Teams meeting of 7/16/2025 3:30
        const lineCount = curRecord.getLineCount({ sublistId: 'item' });
        const itemtypes = ['Assembly', 'Inventory', 'InvtPart'];
        const allLines = [];
        for (let i = 0; i < lineCount; i++) {
            const itemtype = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i }));
            if (itemtypes.includes(itemtype)) {
                const quantity = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }));
                const itemgroup = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_fd_tls_item_group', line: i }));
                allLines[i] = { line: i, quantity, itemgroup };
            }
        }
        const isAddOnRush = curRecord.getValue({ fieldId: 'custbody_mb_so_add_on_accessories' });
        const isReplacement = Number(curRecord.getValue({ fieldId: 'custbody_yy_so_replacement' }));
        const cabinetLineQtys = allLines.filter(line => line.itemgroup === 1).reduce((total, line) => total += line.quantity || 0, 0);
        const accessoryLineQtys = allLines.filter(line => line.itemgroup === 2).reduce((total, line) => total += line.quantity || 0, 0);
        const isOverCabRushLimit = cabinetLineQtys > 3;
        const isOverAccRushLimit = accessoryLineQtys > 5;
        if (isAddOnRush && (!isReplacement || isOverCabRushLimit || isOverAccRushLimit)) {
            // Rush is not valid
            curRecord.setValue({ fieldId: 'custbody_mb_so_add_on_accessories', value: false });
            return false;
        }
        return true; // Valid Rush
    }
    function validateShipDate(curRecord, client, oldShipDate, oldboshipdate, oldtransferdate) {
        //#region Role Exceptions
        let customer = Number(curRecord.getValue({ fieldId: 'entity' }));
        // Exclude accountants
        const acctRoles = [1000, 1001, 1027, 1035]; // CNC A/P Analyst, CNC A/R Analyst, CNC A/R Manager, CNC CFO
        if (acctRoles.includes(Number(runtime.getCurrentUser().role))) {
            return;
        }
        //Katrina needs to be able to set dates for KFD
        /* if (customer === 525 && runtime.getCurrentUser().id === 178185) {
            return;
        }
        //Tami needs to be able to set dates for FERRAZZANO, INT, INT-NHC, and INT-L22
        if ([125621, 5733, 152809, 193188].includes(customer) && runtime.getCurrentUser().id === 136228) {
            return;
        }
        //Dawn needs to be able to set dates for NORFOLK-MA and NORFOLK-NH
        if ([172215, 172214].includes(customer) && runtime.getCurrentUser().id === 104977) {
            return;
        }
        //RRFLR needs quicker ship dates for their orders
        if ([214658].includes(customer)) {
            return;
        } */
        //#endregion
        const automatedShipDates = [];
        const lineCount = curRecord.getLineCount({ sublistId: 'item' });
        const itemTypes = [];
        for (let line = 0; line < lineCount; line++) {
            const itemtype = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line }));
            const isClosed = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line });
            if (!isClosed) {
                itemTypes.push(itemtype);
            }
        }
        if (!itemTypes.includes('Assembly') && !itemTypes.includes('InvtPart')) {
            return;
        }
        let earliest = null;
        let latest = null;
        for (let i = 0; i < lineCount; i++) {
            const isClosed = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i });
            if (isClosed) {
                continue;
            }
            let shipdate = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_lead_time', line: i });
            if (latest === null || shipdate > latest) {
                latest = shipdate;
            }
            if (earliest === null || shipdate < earliest) {
                earliest = shipdate;
            }
            if (shipdate) {
                automatedShipDates.push(shipdate);
            }
        }
        const shipPreference = String(curRecord.getValue({ fieldId: 'custbody_yy_so_shippref' }));
        const rush = curRecord.getValue({ fieldId: 'custbody_ah_override_shipdate' });
        const addonrush = curRecord.getValue({ fieldId: 'custbody_mb_so_add_on_accessories' });
        let shipComplete = shipPreference === '1';
        let shipdate;
        let earlyshipdate;
        // Do we specifically want to treat empty like ship available? (The field is not required on quotes so it can be empty until the SO gets saved) Answer: This doesn't run on quotes
        if (shipComplete) {
            shipdate = curRecord.getValue({ fieldId: 'shipdate' });
        }
        else {
            shipdate = curRecord.getValue({ fieldId: 'custbody_yy_so_bodate' }) || curRecord.getValue({ fieldId: 'shipdate' });
            earlyshipdate = curRecord.getValue({ fieldId: 'shipdate' });
        }
        if (automatedShipDates.length === 0) {
            return;
        }
        //#region Validate Ship Dates
        if (latest > shipdate && !rush) {
            const date = new Date(String(latest));
            if (client && oldShipDate && oldShipDate > shipdate && oldShipDate < latest) { //if they chose an earlier shipdate and now the original is too early
                alert('The new ship date chosen is not allowing sufficient time for production. This page will refresh and you can enter your previous date.');
                location.reload();
                //reload doesn't stop the save - the caller has to block it or the new date gets submitted before the reload happens
                return { error: true, message: '', reload: true };
            }
            else {
                return { error: true, message: `The selected ship date/ backorder ship date does not allow sufficient time for production. Please choose a later date. Earliest date possible: ${date.toLocaleDateString()}` };
            }
        }
        if (earlyshipdate < earliest && !shipComplete && !rush) {
            const date = new Date(String(earliest));
            return { error: true, message: `The ship date you select must ensure that at least one item on the order will be ready by that date. Earliest: ${date.toLocaleDateString()}` };
        }
        let shipdateitems = [];
        let boshipdateitems = [];
        let transferdateitems = [];
        let loca = String(curRecord.getValue({ fieldId: 'location' }));
        shipdate = curRecord.getValue({ fieldId: 'shipdate' });
        let boshipdate = curRecord.getValue({ fieldId: 'custbody_yy_so_bodate' });
        let transferdate = curRecord.getValue({ fieldId: 'custbody_yy_so_xferdate' });
        let proddates = false;
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
        for (let i = 0; i < lineCount; i++) {
            const itemtype = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i }));
            const isClosed = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i });
            if (['Assembly', 'Inventory', 'InvtPart'].includes(itemtype) && !isClosed) {
                const item = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
                const quantity = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }));
                let proddate = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_so_proddate', line: i });
                const buildable = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_buildable_text', line: i })).length === 0;
                let cncclass = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_cncclass', line: i }));
                let collection = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: i }));
                let cfg = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_cut_for_glass', line: i }); //cut for glass
                let wce = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_con_wall_cut_down_extend', line: i }));
                let finishedinterior = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_finished_interior', line: i });
                let itemgroup = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_fd_tls_item_group', line: i }));
                let itemtypecust = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_type', line: i }));
                let bct = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_mod_cutdown', line: i }));
                let hasMods = false;
                let mods = Object.keys(modifications).reduce((acc, val) => {
                    let modifications;
                    // SS2 does not work for modifications in client script
                    //@ts-ignore
                    /* if (nlapiGetLineItemValue) {
                        //@ts-ignore
                        //modifications = nlapiGetLineItemValue('item', val, i + 1);
                    } */
                    // nlapiGetLineItemValue does not work in SS2
                    modifications = curRecord.getSublistValue({ sublistId: 'item', fieldId: val, line: i });
                    //const option = nlapiGetLineItemValue('item', val, line + 1);
                    if (modifications) {
                        hasMods = true;
                    }
                    return acc;
                }, {});
                if (!(!proddate && proddate === '')) {
                    proddates = true;
                }
                //---------------didn't figure out transfers yet
                if (boshipdate && !shipComplete) {
                    const leadTime = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_lead_time', line: i });
                    if (new Date(leadTime) <= new Date(shipdate)) {
                        shipdateitems.push({ item, quantity, hasMods, buildable, cncclass, collection, itemtype, cfg, wce, finishedinterior, itemgroup, itemtypecust, line: i, bct });
                    }
                    else {
                        boshipdateitems.push({ item, quantity, hasMods, buildable, cncclass, collection, itemtype, cfg, wce, finishedinterior, itemgroup, itemtypecust, line: i, bct });
                    }
                }
                else {
                    shipdateitems.push({ item, quantity, hasMods, buildable, cncclass, collection, itemtype, cfg, wce, finishedinterior, itemgroup, itemtypecust, line: i, bct });
                }
            }
        }
        let shipmethod = curRecord.getValue({ fieldId: 'shipmethod' });
        //will never have boitems for transfer because it's always ship complete
        let { loc, itemsForTS, tsNeeded } = (0, cnc_functions_js_1.decideTransfer)(loca, shipmethod, shipdateitems, false);
        if (tsNeeded && curRecord.type === record.Type.SALES_ORDER && transferdate && !rush && (!oldtransferdate || oldtransferdate.toLocaleDateString() !== transferdate.toLocaleDateString())) {
            let transferdateResult = checkShipDate(shipdateitems, transferdate, loc, proddates, tsNeeded, !!addonrush);
            if (transferdateResult) {
                return { error: true, message: transferdateResult.message };
            }
        }
        //we only want this to run if the shipdate was changed and it's not a manager rush
        if ((!oldShipDate || oldShipDate.toLocaleDateString() !== shipdate.toLocaleDateString()) && !rush) {
            let shipdateResult = checkShipDate(shipdateitems, shipdate, loc, proddates, tsNeeded, !!addonrush);
            if (shipdateResult) { //if the shipdate needs to be changed
                return { error: true, message: shipdateResult.message };
            }
        }
        if (boshipdateitems.length > 0 && oldboshipdate.toLocaleDateString() !== boshipdate.toLocaleDateString() && !rush) {
            let boshipdateResult = checkShipDate(boshipdateitems, boshipdate, loca, proddates, false, !!addonrush);
            if (boshipdateResult) {
                return { error: true, message: boshipdateResult.message };
            }
        }
        //#endregion
    }
    ;
    function checkShipDate(items, shipdate, location, proddates, tsNeeded, rush) {
        const blackout = query.runSuiteQL({
            query: `
                    SELECT TO_DATE(custrecord13) AS date, custrecord_ah_truckschedule AS days 
                    FROM customrecord_yy_blackout
                    WHERE custrecord13 >= CURRENT_DATE
                `
        }).asMappedResults();
        let blackoutDates = {};
        for (let i = 0; i < blackout.length; i++) { //get all the blackout dates
            blackoutDates[String(blackout[i].date)] = blackout[i].days;
        }
        // if there's no production dates yet then we want to enforce the ship date by production capacity otherwise it's enforced through shipping capacity
        if (!proddates) {
            let itemCapacities = query.runSuiteQL({
                query: `
        SELECT item.id, llt.custrecord_ah_llt_capacity AS capacity, llt.custrecord_ah_mod_spec_capacity AS modcap, llt.custrecord_ah_llt_rush_capacity AS rushcap, 
        item.custitem_yy_cutspray AS cutspray, CASE WHEN item.custitem_ah_fudgeable_nj IS NOT NULL THEN custitem_ah_fudgeable_nj ELSE -1 END  AS fudgeable,
        CASE WHEN item.custitem_ah_item_lt IN (10, 11) THEN 'T' ELSE 'F' END AS countertop, item.custitem_mb_item_group AS itemgroup
        FROM item
        JOIN customrecord_ah_lead_times_by_location llt ON llt.custrecord_ah_llt_parent = item.custitem_ah_item_lt
            AND llt.custrecord_ah_llt_location = ${tsNeeded ? 7 : location}
        WHERE item.id IN (${items.map(i => i.item).join(',')})
        `
            }).asMappedResults();
            //only NJ capacities are specified so satellite locations will default to 2
            let maxDaysBeforeShip = 0;
            const capidMap = new Map(itemCapacities.map(c => [
                String(c.id),
                {
                    capacity: c.capacity,
                    modcap: c.modcap,
                    rushcap: c.rushcap,
                    cutspray: c.cutspray,
                    fudgeable: c.fudgeable,
                    countertop: c.countertop,
                    itemgroup: c.itemgroup
                }
            ]));
            const fullItemDetails = items.map(q => {
                const capacities = capidMap.get(String(q.item));
                return {
                    ...q,
                    ...capacities
                };
            });
            let capids = new Set();
            for (const [i, item] of fullItemDetails.entries()) {
                let daysBeforeShip = 2;
                if (rush && String(item.rushcap) !== '0') {
                    daysBeforeShip = prod_days_before_ship_1.prodDaysBeforeShipDate[String(item.rushcap)] || 2;
                    fullItemDetails[i]['capid'] = item.rushcap;
                    capids.add(Number(item.rushcap));
                }
                //make sure that uses dart modified capacity if mods or fudging it
                else if ((item.hasMods || (!item.buildable && Number(item.fudgeable) >= 0)) && String(item.capacity) === '1') {
                    daysBeforeShip = prod_days_before_ship_1.prodDaysBeforeShipDate['2'] || 2;
                    fullItemDetails[i]['capid'] = item.modcap;
                    capids.add(Number(item.modcap));
                }
                else {
                    daysBeforeShip = prod_days_before_ship_1.prodDaysBeforeShipDate[String(item.capacity)] || 2;
                    fullItemDetails[i]['capid'] = item.capacity;
                    capids.add(Number(item.capacity));
                }
                let assemblyDate = new Date(shipdate.toString());
                while (daysBeforeShip > 0) {
                    assemblyDate.setDate(assemblyDate.getDate() - 1);
                    let assemblyString = assemblyDate.toLocaleDateString();
                    while (Object.keys(blackoutDates).includes(assemblyString) || [0, 6].includes(assemblyDate.getDay())) {
                        assemblyDate.setDate(assemblyDate.getDate() - 1);
                        assemblyString = assemblyDate.toLocaleDateString();
                    }
                    daysBeforeShip -= 1;
                }
                fullItemDetails[i]['assemblyDate'] = assemblyDate;
            }
            const customCapacityResults = query.runSuiteQL({
                query: `
        SELECT custrecord_nk_custom_capacity_limit AS custcapacity, custrecord_nk_custom_capacity_date AS date, custcap.id AS custcapid, 
        custrecord_date_scheduled_amount AS scheduledamount, custrecord_ah_default_prod_capacity AS defaultcapacity, customrecord_ah_prod_capacity.id AS parentid
        FROM customrecord_nk_custom_date_capacity custcap
        RIGHT JOIN customrecord_ah_prod_capacity ON custcap.custrecord_nk_custom_capacity_parent = customrecord_ah_prod_capacity.id
            AND custrecord_nk_custom_capacity_date BETWEEN CURRENT_DATE - 10 AND CURRENT_DATE + 400
            AND customrecord_ah_prod_capacity.id IN (${[...capids].join(',')})
        `
            }).asMappedResults();
            const custCapacityDict = customCapacityResults.reduce((acc, result) => {
                acc[Number(result.parentid)] ||= { defaultcapacity: 0, capacityDict: {} };
                acc[Number(result.parentid)]['capacityDict'] ||= {};
                acc[Number(result.parentid)]['defaultcapacity'] = Number(result.defaultcapacity);
                acc[Number(result.parentid)]['capacityDict'][String(result.date)] = { capacity: Number(result.custcapacity), id: Number(result.custcapid), scheduledamount: Number(result.scheduledamount ?? 0) };
                return acc;
            }, {});
            let insufficientSpace = true;
            const capacityQuantities = fullItemDetails.reduce((acc, item) => {
                if (item.countertop !== 'T' && item.itemgroup === 1) {
                    acc[item['capid']] ||= {};
                    acc[item['capid']].quantity ||= 0;
                    acc[item['capid']].quantity += item.quantity;
                    acc[item['capid']].assemblyDate = item.assemblyDate;
                }
                return acc;
            }, {});
            let daysToPush = 0;
            if (Object.keys(capacityQuantities).length) {
                while (insufficientSpace) {
                    for (const capid of Object.keys(capacityQuantities)) {
                        //default space available to the default capacity
                        let curCapacity = custCapacityDict[capid]['defaultcapacity'];
                        let spaceAvailable = curCapacity;
                        const capacityObj = custCapacityDict[capid]['capacityDict'][capacityQuantities[capid].assemblyDate.toLocaleDateString()];
                        //if there are no custom capacities for that date yet then it will use the defualt capacity, otherwise it will reset it.
                        if (capacityObj) {
                            curCapacity = capacityObj.capacity;
                            spaceAvailable = capacityObj.capacity - capacityObj.scheduledamount;
                        }
                        if (spaceAvailable >= capacityQuantities[capid].quantity || capacityQuantities[capid].quantity > curCapacity) {
                            if (capacityObj) {
                                capacityObj.scheduledamount += capacityQuantities[capid].quantity;
                            }
                        }
                        else {
                            capacityQuantities[capid].assemblyDate = (0, total_days_to_push_1.getNextBusinessDay)(capacityQuantities[capid].assemblyDate, 1, blackoutDates);
                            //if the current lead time is full then increment by another day
                            daysToPush += 1;
                            //this capacity doesn't have space (it may have been changed to false if the previous capacity did have enough space)
                            insufficientSpace = true;
                            break;
                        }
                        insufficientSpace = false;
                    }
                }
            }
            //if we have to push the ship date based on capacity
            if (daysToPush > 0) {
                let newShipDate = (0, total_days_to_push_1.getNextBusinessDay)(new Date(shipdate.toString()), daysToPush, blackoutDates);
                if (tsNeeded) { //make sure that the new transfer date is on the right day of the week
                    const transferDay = shipdate.getDay();
                    const newTransferDay = newShipDate.getDay();
                    if (transferDay !== newTransferDay) {
                        while (newShipDate.getDay() !== transferDay) {
                            newShipDate = (0, total_days_to_push_1.getNextBusinessDay)(newShipDate, 1, blackoutDates);
                        }
                    }
                }
                const message = `Production capacity cannot accommodate the selected ${tsNeeded ? 'transfer' : 'ship'} date. Please move the ${tsNeeded ? 'transfer' : 'ship'} date. Suggested date: ${newShipDate.toLocaleDateString()}`;
                return { shipDate: newShipDate, message };
            }
        }
        else { //there are production dates already so we just need to check the shipping capacity
            if ([3544].includes(runtime.getCurrentUser().id)) {
                const customShipCapacitiesResults = query.runSuiteQL({
                    query: `
                SELECT csc.id, custrecord_ah_sc_location, custrecord_nk_csc_limit AS limit, custrecord_nk_csc_date AS date, 
                custrecord_nk_csc_scheduled AS amountscheduled, custrecord_ah_sc_default AS defaultcapacity, sc.id AS parentid
                FROM customrecord_ah_shipping_capacity sc
                LEFT JOIN customrecord_nk_csc_custom_ship_capacity csc ON sc.id = csc.custrecord_nk_csc_parent
                    AND csc.custrecord_nk_csc_date >= CURRENT_DATE
                WHERE sc.custrecord_ah_sc_location = ${location}
                AND sc.custrecord_ah_sc_transfer != 'T'
        `
                }).asMappedResults();
                const custCapacityDict = customShipCapacitiesResults.reduce((acc, result) => {
                    acc[Number(result.parentid)] ||= { defaultcapacity: 0, capacityDict: {} };
                    acc[Number(result.parentid)]['capacityDict'] ||= {};
                    acc[Number(result.parentid)]['defaultcapacity'] = Number(result.defaultcapacity);
                    acc[Number(result.parentid)]['capacityDict'][String(result.date)] = { capacity: Number(result.custcapacity), id: Number(result.custcapid), scheduledamount: Number(result.scheduledamount ?? 0) };
                    return acc;
                }, {});
                let shipDate = new Date(String(shipdate));
                let insufficientSpace = true;
                let daysToPush = 0;
                const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
                while (insufficientSpace) {
                    //default space available to the default capacity
                    let curCapacity = custCapacityDict[Object.keys(custCapacityDict)[0]]['defaultcapacity'];
                    let spaceAvailable = curCapacity;
                    const capacityObj = custCapacityDict[Object.keys(custCapacityDict)[0]]['capacityDict'][shipDate.toLocaleDateString()];
                    //if there are no custom capacities for that date yet then it will use the defualt capacity, otherwise it will reset it.
                    if (capacityObj) {
                        curCapacity = capacityObj.capacity;
                        spaceAvailable = capacityObj.capacity - capacityObj.scheduledamount;
                    }
                    if (spaceAvailable >= totalQuantity || totalQuantity > curCapacity) {
                        if (capacityObj) {
                            capacityObj.scheduledamount += totalQuantity;
                        }
                        insufficientSpace = false;
                    }
                    else {
                        shipDate = (0, total_days_to_push_1.getNextBusinessDay)(shipDate, 1, blackoutDates);
                        daysToPush += 1;
                    }
                }
                if (daysToPush > 0) {
                    const message = `The ship date on this order has been moved to ${shipDate.toLocaleDateString()} based on shipping capacity.`;
                    return { shipDate, message };
                }
            }
        }
    }
});
