define(["require", "exports", "N/query", "N/log", "N/record", "N/error", "./decideTransfer"], function (require, exports, query, log, record, error, decideTransfer_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.beforeSubmit = beforeSubmit;
    exports.afterSubmit = afterSubmit;
    /**
     * @NAPIVersion 2.1
     * @NScriptType UserEventScript
     * @Author Ariella Hirsch
     * beforeSubmit: flags the lines that need a transfer and sets the transfer date
     * afterSubmit: creates the transfer order once the sales order is approved
     */
    async function beforeSubmit(context) {
        try {
            const curRecord = context.newRecord;
            let lineCount = curRecord.getLineCount({ sublistId: 'item' });
            let location = Number(curRecord.getValue({ fieldId: 'location' }));
            let transferCreated = curRecord.getValue({ fieldId: 'custbody_yy_so_to_xferrecord' });
            let shipmethod = Number(curRecord.getValue({ fieldId: 'shipmethod' }));
            let keepLocation = curRecord.getValue({ fieldId: 'custbody_ah_keeplocation' });
            if (transferCreated) { //if a transfer order was already created then return (don't want to keep moving the date)
                return;
            }
            if (location === 7 || location === 13) { //NJ or dropship orders never need a transfer
                return;
            }
            if (curRecord.getValue({ fieldId: 'custbody_ah_manual_transfers' })) {
                return;
            }
            let items = [];
            //#region Decide Transfer
            for (let i = 0; i < lineCount; i++) { //get all the items that need to be transferred from the so
                let curItem = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
                let itemtype = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i }));
                let quantity = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }));
                let cfg = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_cut_for_glass', line: i })); //cut for glass
                let wce = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_con_wall_cut_down_extend', line: i }));
                let finishedinterior = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_finished_interior', line: i }));
                let bct = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_mod_cutdown', line: i }));
                let itemtypecust = Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_type', line: i }));
                items.push({ item: curItem, itemtype, quantity, locations: [], cfg, wce, finishedinterior, finishedInterior: finishedinterior, line: i, bct, itemtypecust });
                //set all transfer necessary checkboxes back to false (if they need a transfer it will get reset later on)
                curRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_transfernecessary', line: i, value: false });
            }
            const { loc, itemsForTs, tsNeeded } = (0, decideTransfer_1.decideTransfer)(location, shipmethod, items, !!keepLocation);
            curRecord.setValue({ fieldId: 'location', value: loc });
            if (!tsNeeded) {
                return;
            }
            log.debug('itemsForTs', itemsForTs);
            for (const item of itemsForTs) {
                curRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_transfernecessary', line: item.line, value: true });
            }
            //#endregion
            if (tsNeeded) {
                let shipDateField = curRecord.getValue({ fieldId: 'shipdate' });
                let shipDate = new Date(String(shipDateField)) || new Date();
                //get the latest lead time
                const lineCount = curRecord.getLineCount({ sublistId: 'item' });
                let latest = new Date(String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_lead_time', line: 0 })));
                for (let i = 0; i < lineCount; i++) {
                    let leadTime = new Date(String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_lead_time', line: i })));
                    if (leadTime > latest) {
                        latest = leadTime;
                    }
                }
                const MS_IN_DAY = 1000 * 60 * 60 * 24;
                const diffMs = Math.abs(latest.getTime() - shipDate.getTime());
                const diffDays = diffMs / MS_IN_DAY;
                if (diffDays > 21) { //only run if shipdate is not within 3 weeks of the leadtime
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
                    if (formattedDate in blackoutDates) { //push out if it lands on a blackout date (yom tov)
                        log.audit('after3weekssecondblackoutDate', xferDate.toLocaleDateString());
                        xferDate.setDate(xferDate.getDate() + Number(blackoutDates[formattedDate]));
                    }
                    //#endregion
                    curRecord.setValue({ fieldId: 'custbody_yy_qu_transfercheck', value: true }); //check the To Be Transferred Checkbox
                    curRecord.setValue({ fieldId: 'custbody_yy_so_shippref', value: 1 }); //fix error that says xfer must be ship complete (a client error thrown via the Sales Order Defaults workflow).
                    if (!curRecord.getValue({ fieldId: 'custbody_ah_rush_order' })) {
                        curRecord.setValue({ fieldId: 'custbody_yy_so_xferdate', value: xferDate });
                    }
                }
            }
        }
        catch (e) {
            log.error('Error Setting Transfer Date', e.message + 'stack: ' + e.stack);
        }
    }
    ;
    function afterSubmit(context) {
        let { newRecord, type } = context;
        if (type.toString() == 'delete') {
            return;
        }
        if (newRecord.getValue({ fieldId: 'custbody_ah_manual_transfers' })) {
            return;
        }
        var tranid = newRecord.getValue('tranid');
        var approved = newRecord.getValue('orderstatus') === 'B' || type.toString() == 'approve';
        var xferdatefield = newRecord.getValue('custbody_yy_so_xferdate');
        var xferdate = new Date(String(xferdatefield));
        var xferrecord = newRecord.getValue('custbody_yy_so_to_xferrecord');
        var location = newRecord.getValue('location');
        if (!xferdatefield) {
            let transferStatus = newRecord.getValue({ fieldId: 'custbody_yy_so_transfer_status' });
            //if there's no transfer date then set the transfer status to null
            if (newRecord.type === record.Type.SALES_ORDER && transferStatus) {
                record.submitFields({ type: record.Type.SALES_ORDER, id: newRecord.id, values: { 'custbody_yy_so_transferstatus': null } });
            }
            return;
        }
        if (typeof xferdate.toString == 'function' && xferdate.toString() == 'Invalid Date') {
            log.debug('Audit', 'Invalid Date (Format) On SO: ' + tranid);
            return;
        }
        if (xferrecord) {
            log.debug('Can not create TO for ' + tranid, 'TO Already Created For This SO');
            return;
        }
        if (location == '7') {
            return;
        }
        if (!approved) {
            return;
        }
        // set the transfer status to Pending Transfer
        record.submitFields({ type: record.Type.SALES_ORDER, id: newRecord.id, values: { 'custbody_yy_so_transferstatus': 4 } });
        let curRecord = record.load({ type: record.Type.SALES_ORDER, id: newRecord.id });
        var soshipdate = curRecord.getValue('shipdate');
        tranid = curRecord.getValue('tranid');
        let flocation = 7;
        var transferlocation = curRecord.getValue('location');
        let tsSublist = [];
        let lineCount = curRecord.getLineCount({ sublistId: 'item' });
        var items = new Set();
        for (let i = 0; i < lineCount; i++) {
            let itemType = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i }));
            let isclosed = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i });
            let needsTS = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_transfernecessary', line: i });
            if (!isclosed && ['Assembly', 'Inventory', 'InvtPart'].includes(itemType) && needsTS) {
                tsSublist.push({
                    item: Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i })),
                    quantity: Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })),
                    itemType,
                    soLineId: Number(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i })),
                    woid: String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'woid', line: i })) //String, not Number: Number('') is 0, which breaks setting the field when empty
                });
            }
        }
        if (tsSublist.length === 0) {
            throw error.create({
                name: 'NO_ITEMS_NEED_TRANSFER',
                message: 'There are no items on this order that require a transfer. Please remove the transfer date to save the order.',
                notifyOff: true
            });
        }
        var transfer = record.create({
            type: record.Type.TRANSFER_ORDER,
            isDynamic: true
        });
        transfer.setValue({ fieldId: 'subsidiary', value: 2 });
        transfer.setValue({ fieldId: 'tranid', value: `T${tranid}` });
        transfer.setValue({ fieldId: 'location', value: flocation });
        transfer.setValue({ fieldId: 'transferlocation', value: transferlocation });
        transfer.setValue({ fieldId: 'shipdate', value: xferdate });
        transfer.setValue({ fieldId: 'custbody_yy_so_xferdate', value: soshipdate });
        transfer.setValue({ fieldId: 'custbody_yy_so_to_xferrecord', value: curRecord.id });
        log.debug('tsSublist', tsSublist);
        for (let i = 0; i < tsSublist.length; i++) {
            transfer.selectNewLine({ sublistId: 'item' });
            transfer.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: tsSublist[i].item });
            transfer.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: tsSublist[i].quantity });
            transfer.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_so_line_id', value: tsSublist[i].soLineId, ignoreFieldChange: true });
            if (!['Inventory', 'InvtPart'].includes(tsSublist[i].itemType)) { //inventory items have no WO, so only assemblies get the work order on the TO line
                transfer.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_fd_wit_for_work_order', value: tsSublist[i].woid, ignoreFieldChange: true });
                const custbody_yy_so_accountmanager = newRecord.getValue('custbody_yy_so_accountmanager');
                if (!tsSublist[i].woid && custbody_yy_so_accountmanager != 'Dawn Smith') {
                    throw error.create({
                        name: 'MISSING_WORK_ORDER',
                        message: 'Missing work order for items on this order.',
                        notifyOff: true
                    });
                }
            }
            transfer.commitLine({ sublistId: 'item' });
            items.add(Number(tsSublist[i].item));
        }
        try {
            var results = query.runSuiteQL({
                query: `
            SELECT
                id, itemid, lastpurchaseprice, averagecost, cost
            FROM 
                item
            WHERE
                id IN (${[...items].join(',')})
        `
            }).asMappedResults();
            log.debug('rate results', results);
            for (var line = 0; line < transfer.getLineCount('item'); line++) {
                var item = transfer.getSublistValue({ sublistId: 'item', fieldId: 'item', line });
                var corresponding = results.find(result => result.id == item);
                var { lastpurchaseprice, averagecost, cost } = corresponding || {};
                var rate = lastpurchaseprice || averagecost || cost || 0.1;
                transfer.selectLine({ sublistId: 'item', line });
                transfer.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: Number(rate), ignoreFieldChange: true });
                transfer.commitLine({ sublistId: 'item' });
            }
        }
        catch (e) {
            log.error('@afterSubmit', e.message + 'stack: ' + e.stack);
        }
        let toid = transfer.save();
        log.debug('toid', toid);
        let id = curRecord.id;
        record.submitFields({ type: record.Type.SALES_ORDER, id, values: { 'custbody_yy_so_to_xferrecord': toid } });
    }
    ;
});
