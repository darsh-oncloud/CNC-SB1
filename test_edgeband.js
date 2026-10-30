define(["require", "exports", "N/log", "N/runtime", "N/query"], function (require, exports, log, runtime, query) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.beforeSubmit = beforeSubmit;
    /**
     * @Description Sales Order user event script.
     * @NApiVersion 2.1
     * @NScriptType UserEventScript
     */
    function beforeSubmit(context) {
        if (runtime.getCurrentUser().id === 156044) {
            automateBlumChargeOnly(context, false);
            automateEdgebandCharge(context, false);
            automateReededCharges(context, false);
        }
    }
    function automateEdgebandCharge(context, chargeApplied) {
        let newRecord = context.newRecord;
        let chargeItem = 429827;
        //let chargeItem = 309756; //sb2 item
        let source = newRecord.getValue({ fieldId: 'source' });
        //let chargeApplied = newRecord.getValue({ fieldId: 'custbody_ah_charges_applied' }); //if the charge was already added to the order
        if (source === 'Web (Cabnet by CNC Cabinetry)') { //if cabnet order don't apply charges
            chargeApplied = true; //Cabnet sets charges already
        }
        let charge = 0;
        let lineCount = newRecord.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < lineCount; i++) { //mark all the line items if blum or not
            //right now blum option (in Netsuite) is available for most items but if it's not then have to check if the field exists first
            var edgebandOptions = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_mod_edgeband', line: i });
            let curItem = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
            let itemtype = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
            if (edgebandOptions !== '1' && (itemtype === 'Assembly' || itemtype === 'InvtPart')) { //when click into mods all other available mods give a weird icon as the value
                continue;
            }
            else { //there's an edgeband
                if (edgebandOptions === '1' && !chargeApplied) { //if blum, set to true
                    let amount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
                    charge += amount * .1; //10% upcharge on each blum upgrade item.
                }
                if (curItem === -2 && !chargeApplied && charge > 0) { //if it's a subtotal item
                    log.debug('@EdgebandBeforeSubmit: subtotal item', curItem);
                    newRecord.insertLine({ sublistId: 'item', line: i });
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: i, value: chargeItem });
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: i, value: charge });
                    newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true }); //set to true if added here (will still be able to add the rest)
                    lineCount = newRecord.getLineCount({ sublistId: 'item' });
                    i++; //prevent from running on a subtotal line again and inserting many blum charge lines
                    charge = 0;
                }
                if (itemtype === 'Discount' && !chargeApplied) {
                    let prevItem = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i - 1 }));
                    if (!(prevItem === -2)) { //make sure this is not a discount after a subtotal
                        let prevItemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i - 1 });
                        let subtractNum = 1; //amount of lines to go back after a discount (there may be a charge)
                        while (prevItemType !== 'Assembly' && prevItemType !== 'InvtPart') {
                            subtractNum++;
                            prevItemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i - subtractNum });
                        }
                        let itemAmount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i - subtractNum }));
                        charge -= itemAmount * .1; //remove the amount that was already added to the charge variable
                        let discountAmount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
                        let subtotal = itemAmount + discountAmount;
                        charge += subtotal * .1; //add on the charge after the discount is applied
                    }
                }
            }
        }
        if (charge > 0) { //if there's a charge still, add it to the bottom of the order
            log.debug('eb line count before charge', newRecord.getLineCount({ sublistId: 'item' }));
            newRecord.insertLine({ sublistId: 'item', line: lineCount });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: lineCount, value: chargeItem });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: lineCount, value: charge });
            newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true });
            lineCount = newRecord.getLineCount({ sublistId: 'item' });
            log.debug('eb line count after charge', newRecord.getLineCount({ sublistId: 'item' }));
            charge = 0;
            log.debug('new charge item', newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: lineCount - 1 }));
        }
    }
    function automateBlumChargeOnly(context, chargeApplied) {
        let newRecord = context.newRecord;
        let chargeItem;
        chargeItem = 306578;
        let source = newRecord.getValue({ fieldId: 'source' });
        // let standardBlum = [348, 518, 396, 395, 519, 398, 397, 586, 578, 576, 577, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541, 542, 543, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531];
        //let chargeApplied = newRecord.getValue({ fieldId: 'custbody_ah_charges_applied' }); //if the charge was already added to the order
        const customer = String(newRecord.getValue({ fieldId: 'entity' }));
        const classicExemptCustomers = ['1003']; //EXP is exempt from blum on classic cabinets
        /* if (exemptCustomers.includes(customer)) {
            chargeApplied = true; //EXEMPT from charges
        } */
        if (source === 'Web (Cabnet by CNC Cabinetry)') { //if cabnet order don't apply charges
            chargeApplied = true; //Cabnet sets charges already
        }
        let charge = 0;
        let lineCount = newRecord.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < lineCount; i++) { //mark all the line items if blum or not
            //right now blum option (in Netsuite) is available for most items but if it's not then have to check if the field exists first
            var blumOptions = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_mod_blumhinges', line: i });
            let curItem = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
            let itemtype = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
            let collection = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: i }));
            if (collection === 2 && classicExemptCustomers.includes(customer)) {
                chargeApplied = true; //EXEMPT from charges if it's a classic cabinet and the customer is in the exempt list
            }
            //log.debug('@AHBlumueBeforeSubmit: itemtype', itemtype);
            //log.debug('@AHBlumueBeforeSubmit: blum options', blumOptions);
            if (blumOptions !== '1' && (itemtype === 'Assembly' || itemtype === 'InvtPart')) { //when click into mods all other available mods give a weird icon as the value
                continue;
            }
            else { //there's a blum upgrade
                if (blumOptions === '1') { //if blum, set to true
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_blum_hinges', line: i, value: true });
                    if (!chargeApplied) {
                        let amount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
                        charge += amount * .1; //10% upcharge on each blum upgrade item.
                    }
                }
                else if (newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_blum_hinges', line: i })) {
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_blum_hinges', line: i, value: false });
                }
                if (curItem === -2 && !chargeApplied && charge > 0) { //if it's a subtotal item
                    log.debug('@AHBlumueBeforeSubmit: subtotal item', curItem);
                    newRecord.insertLine({ sublistId: 'item', line: i });
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: i, value: chargeItem });
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: i, value: charge });
                    newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true }); //set to true if added here (will still be able to add the rest)
                    lineCount = newRecord.getLineCount({ sublistId: 'item' });
                    i++; //prevent from running on a subtotal line again and inserting many blum charge lines
                    charge = 0;
                }
                if (itemtype === 'Discount' && !chargeApplied) {
                    let prevItem = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i - 1 }));
                    if (!(prevItem === -2)) { //make sure this is not a discount after a subtotal
                        let prevItemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i - 1 });
                        //log.debug('@AHBlumueBeforeSubmit: previtemtype', prevItemType);
                        let subtractNum = 1; //amount of lines to go back after a discount (there may be a charge)
                        while (prevItemType !== 'Assembly' && prevItemType !== 'InvtPart') {
                            subtractNum++;
                            prevItemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i - subtractNum });
                        }
                        let itemAmount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i - subtractNum }));
                        charge -= itemAmount * .1; //remove the amount that was already added to the charge variable
                        let discountAmount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
                        let subtotal = itemAmount + discountAmount;
                        charge += subtotal * .1; //add on the charge after the discount is applied
                    }
                }
            }
        }
        if (charge > 0) { //if there's a charge still, add it to the bottom of the order
            log.debug('blum line count before charge', newRecord.getLineCount({ sublistId: 'item' }));
            newRecord.insertLine({ sublistId: 'item', line: lineCount });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: lineCount, value: chargeItem });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: lineCount, value: charge });
            newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true });
            lineCount = newRecord.getLineCount({ sublistId: 'item' });
            charge = 0;
            log.debug('blum line count after charge', newRecord.getLineCount({ sublistId: 'item' }));
        }
    }
    function automateReededCharges(context, chargeApplied) {
        const newRecord = context.newRecord;
        const REEDED_FIELD = 'custcol_ap_mod_reeded';
        let lineCount = newRecord.getLineCount('item');
        let hasReededSelection = false;
        for (let line = 0; line < lineCount; line++) {
            let reededSelection = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: REEDED_FIELD,
                line
            });
            if (reededSelection && Number(reededSelection)) {
                hasReededSelection = true;
                break;
            }
        }
        if (!hasReededSelection) {
            log.debug('@automateReededCharges', 'No reeded selections found. Skipping.');
            return;
        }
        const REEDED_CONFIG = {
            TOP_DRAWER_CAB: { rate: 0.15, item: 425310 },
            TOP_DRAWER_DF: { rate: 1.00, item: 425313 },
            DOOR_CAB: { rate: 0.60, item: 425309 },
            DOOR_DR: { rate: 1.00, item: 425312 },
            BOTH_CAB: { rate: 0.60, item: 425311 },
            BOTH_DRDF: { rate: 1.00, item: 425314 }
        };
        const CHARGE_APPLIED_FIELD = 'custbody_ah_charges_applied';
        const DOOR_STYLE_FIELD = 'custitem_mb_item_style';
        const ITEM_TYPE_FIELD = 'custitem_mb_item_item_type';
        const ALLOWED_DOOR_STYLES = [26, 34, 40];
        const REEDED_SELECTIONS = {
            TOP_DRAWER_ONLY: '1',
            DOOR_ONLY: '2',
            FULL_CABINET: '3'
        };
        const ITEM_TYPES = {
            DRDF: [5, 6],
            CAB: [2, 15, 26, 36, 4, 27, 3, 1, 21, 7, 16, 25]
        };
        let source = newRecord.getValue({ fieldId: 'source' });
        //let chargeApplied = newRecord.getValue({ fieldId: CHARGE_APPLIED_FIELD });
        if (source === 'Web (Cabnet by CNC Cabinetry)') {
            chargeApplied = true;
        }
        if (chargeApplied)
            return;
        const itemIds = [];
        for (let line = 0; line < lineCount; line++) {
            const itemId = Number(newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line
            }));
            if (itemId && !itemIds.includes(itemId)) {
                itemIds.push(itemId);
            }
        }
        const itemDataMap = {};
        if (itemIds.length) {
            const results = query.runSuiteQL({
                query: `
                SELECT
                    id,
                    ${DOOR_STYLE_FIELD} AS doorstyle,
                    ${ITEM_TYPE_FIELD} AS itemtype
                FROM item
                WHERE id IN (${itemIds.join(',')})
            `
            }).asMappedResults();
            results.forEach(row => {
                itemDataMap[Number(row.id)] = {
                    doorStyle: Number(row.doorstyle),
                    itemType: Number(row.itemtype)
                };
            });
        }
        log.debug('@automateReededCharges: itemDoorStyleMap', itemDataMap);
        let chargesByItem = {};
        for (let i = 0; i < lineCount; i++) {
            let curItem = Number(newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: i
            }));
            let itemtype = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: i
            });
            if (itemtype == 'Subtotal') {
                if (hasCharges(chargesByItem)) {
                    i = insertChargesByItem(newRecord, i, chargesByItem);
                    newRecord.setValue({ fieldId: CHARGE_APPLIED_FIELD, value: true });
                    lineCount = newRecord.getLineCount({ sublistId: 'item' });
                    chargesByItem = {};
                }
                continue;
            }
            if (itemtype === 'Discount') {
                adjustChargesForDiscount(newRecord, i, chargesByItem);
                continue;
            }
            if (itemtype == 'Assembly' || itemtype == 'InvtPart') {
                let chargeConfig = getLineReededConfig(newRecord, i);
                if (!chargeConfig)
                    continue;
                let amount = Number(newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'amount',
                    line: i
                })) || 0;
                addCharge(chargesByItem, chargeConfig.item, amount * chargeConfig.rate);
            }
        }
        // log.debug('@automateReededCharges: chargesByItem', JSON.stringify(chargesByItem));
        if (hasCharges(chargesByItem)) {
            insertChargesByItem(newRecord, lineCount, chargesByItem);
            newRecord.setValue({ fieldId: CHARGE_APPLIED_FIELD, value: true });
        }
        function getLineReededConfig(newRecord, line) {
            let reededSelection = String(newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: REEDED_FIELD,
                line
            }) || '');
            if (!reededSelection)
                return null;
            const itemId = Number(newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line
            }));
            const doorStyle = itemDataMap[itemId].doorStyle;
            if (!ALLOWED_DOOR_STYLES.includes(doorStyle))
                return null;
            let itemType = itemDataMap[itemId].itemType;
            let isCab = ITEM_TYPES.CAB.includes(itemType);
            let isDrDf = ITEM_TYPES.DRDF.includes(itemType);
            if (reededSelection === REEDED_SELECTIONS.TOP_DRAWER_ONLY) {
                if (isCab)
                    return REEDED_CONFIG.TOP_DRAWER_CAB;
                if (isDrDf)
                    return REEDED_CONFIG.TOP_DRAWER_DF;
            }
            if (reededSelection === REEDED_SELECTIONS.DOOR_ONLY) {
                if (isCab)
                    return REEDED_CONFIG.DOOR_CAB;
                if (isDrDf)
                    return REEDED_CONFIG.DOOR_DR;
            }
            if (reededSelection === REEDED_SELECTIONS.FULL_CABINET) {
                if (isCab)
                    return REEDED_CONFIG.BOTH_CAB;
                if (isDrDf)
                    return REEDED_CONFIG.BOTH_DRDF;
            }
            return null;
        }
        function adjustChargesForDiscount(record, discountLine, chargesByItem) {
            let prevItem = Number(record.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: discountLine - 1
            }));
            if (prevItem === -2)
                return;
            let subtractNum = 1;
            let prevItemType = record.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: discountLine - subtractNum
            });
            while (prevItemType !== 'Assembly' &&
                prevItemType !== 'InvtPart' &&
                discountLine - subtractNum > 0) {
                subtractNum++;
                prevItemType = record.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemtype',
                    line: discountLine - subtractNum
                });
            }
            let itemLine = discountLine - subtractNum;
            let chargeConfig = getLineReededConfig(record, itemLine);
            if (!chargeConfig)
                return;
            let itemAmount = Number(record.getSublistValue({
                sublistId: 'item',
                fieldId: 'amount',
                line: itemLine
            })) || 0;
            let discountAmount = Number(record.getSublistValue({
                sublistId: 'item',
                fieldId: 'amount',
                line: discountLine
            })) || 0;
            addCharge(chargesByItem, chargeConfig.item, -(itemAmount * chargeConfig.rate));
            addCharge(chargesByItem, chargeConfig.item, (itemAmount + discountAmount) * chargeConfig.rate);
        }
        function addCharge(chargesByItem, itemId, amount) {
            chargesByItem[itemId] = (chargesByItem[itemId] || 0) + amount;
        }
        function hasCharges(chargesByItem) {
            return Object.keys(chargesByItem).some(function (itemId) {
                return roundMoney(chargesByItem[itemId]) > 0;
            });
        }
        function insertChargesByItem(record, startLine, chargesByItem) {
            let insertLine = startLine;
            Object.keys(chargesByItem).forEach(function (itemId) {
                let amount = roundMoney(chargesByItem[itemId]);
                if (amount <= 0)
                    return;
                record.insertLine({
                    sublistId: 'item',
                    line: insertLine
                });
                record.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: insertLine,
                    value: Number(itemId)
                });
                // Custom price level
                record.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'price',
                    line: insertLine,
                    value: -1
                });
                record.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: insertLine,
                    value: 1
                });
                record.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: insertLine,
                    value: amount
                });
                record.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'amount',
                    line: insertLine,
                    value: amount
                });
                insertLine++;
            });
            return insertLine;
        }
        function roundMoney(value) {
            return Math.round((Number(value) || 0) * 100) / 100;
        }
    }
});
