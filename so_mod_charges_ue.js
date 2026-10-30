define(["require", "exports", "N/search", "N/log"], function (require, exports, search, log) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.beforeSubmit = beforeSubmit;
    /**
     * @NApiVersion 2.1
     * @NScriptType UserEventScript
     * @Author CNC Dev Team
     * @Description Add charge items to the sales order when a modificaiton is selected.
     */
    const CHARGE_PCT_FIELD = 'custitem_cnc_charge_percentage';
    function getChargePercentage(chargeItemId) {
        try {
            const fields = search.lookupFields({
                type: 'noninventoryitem', // TODO: update if charge items are a different record type
                id: chargeItemId,
                columns: [CHARGE_PCT_FIELD]
            });
            const pct = parseFloat(String(fields[CHARGE_PCT_FIELD]).replace('%', ''));
            return pct > 0 ? pct : null;
        }
        catch (e) {
            log.error({ title: 'getChargePercentage', details: e });
            return null;
        }
    }
    function applyPercentageCharge(chargeItem, percentage, newRecord, chargeApplied) {
        //TODO: Add blum exclusion for EXP---------------------------------------------------
        let charge = 0;
        let lineCount = newRecord.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < lineCount; i++) {
            const modField = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_cnc_so_mod_json', line: i });
            let fullMods = { required: {}, notrequired: {} };
            if (modField)
                fullMods = JSON.parse(String(modField));
            const hasCharge = Object.values(fullMods.notrequired).some(m => m.charge === chargeItem); //only apply if this charge is actually selected on the line's mod json
            let curItem = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
            let itemtype = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
            if (!hasCharge && (itemtype === 'Assembly' || itemtype === 'InvtPart')) {
                continue;
            }
            else {
                if (hasCharge && !chargeApplied) {
                    let amount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
                    charge += amount * (percentage / 100);
                }
                if (curItem === -2 && !chargeApplied && charge > 0) { //if it's a subtotal item
                    newRecord.insertLine({ sublistId: 'item', line: i });
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: i, value: chargeItem });
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: i, value: charge });
                    newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true }); //set to true if added here (will still be able to add the rest)
                    lineCount = newRecord.getLineCount({ sublistId: 'item' });
                    i++; //prevent from running on a subtotal line again and inserting many charge lines
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
                        charge -= itemAmount * (percentage / 100); //remove the amount that was already added to the charge variable
                        let discountAmount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
                        let subtotal = itemAmount + discountAmount;
                        charge += subtotal * (percentage / 100); //add on the charge after the discount is applied
                    }
                }
            }
        }
        if (charge > 0) { //if there's a charge still, add it to the bottom of the order
            newRecord.insertLine({ sublistId: 'item', line: lineCount });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: lineCount, value: chargeItem });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: lineCount, value: charge });
            newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true });
            lineCount = newRecord.getLineCount({ sublistId: 'item' });
            charge = 0;
        }
    }
    function applyStandardCharges(curRecord, line, lineCountIn, flatMods) {
        const items = ['InvtPart', 'Assembly', 'Inventory'];
        let lineCount = lineCountIn;
        let lineNum = line + 1;
        let lastLine = lineNum === lineCount;
        for (const mod in flatMods) {
            let chargeApplied = false;
            if (!lastLine) {
                let itemtype = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: lineNum }));
                while (!items.includes(itemtype) && lineNum !== lineCount) { //if the next line is not the next item, check if the charge for this mod was already applied
                    const item = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: lineNum });
                    if (Number(item) === flatMods[mod].charge) {
                        chargeApplied = true;
                        break;
                    }
                    lineNum++;
                    itemtype = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: lineNum }));
                }
            }
            if (!chargeApplied) { //if the charge for this mod wasn't applied yet, apply it.
                curRecord.insertLine({ sublistId: 'item', line: lineNum });
                curRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', value: flatMods[mod].charge, line: lineNum });
                // curRecord.setSublistValue({ sublistId: 'item', fieldId: 'itemtype', value: 'NonInvtPart', line: lineNum });
                lineCount = curRecord.getLineCount({ sublistId: 'item' });
            }
            lineNum++;
        }
        let itemtype = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: lineNum }));
        //check all the lines to ensure that only the charges for the selected mods are there, if there is a charge that shouldn't be there, remove it.
        while (!items.includes(itemtype) && lineNum !== lineCount) {
            let item = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: lineNum });
            if (!Object.values(flatMods).length || !Object.values(flatMods).some(m => String(m.charge) === String(item))) {
                curRecord.removeLine({ sublistId: 'item', line: lineNum });
                lineCount = curRecord.getLineCount({ sublistId: 'item' });
            }
            else {
                const modKey = Object.keys(flatMods).find(k => String(flatMods[k].charge) === String(item));
                if (modKey)
                    delete flatMods[modKey];
                lineNum++;
            }
            itemtype = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: lineNum }));
        }
        return lineCount;
    }
    function beforeSubmit(context) {
        //TODO: Exculde cabnet and EDI from charges ------------------------------------
        const curRecord = context.newRecord;
        let lineCount = curRecord.getLineCount({ sublistId: 'item' });
        const percentageCharges = {};
        for (let i = 0; i < lineCount; i++) {
            let line = i;
            let chargeList = [];
            const items = ['InvtPart', 'Assembly', 'Inventory'];
            let itemtype = String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: line }));
            const modField = curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_cnc_so_mod_json', line: line });
            if (!items.includes(itemtype))
                continue;
            let fullMods = { required: {}, notrequired: {} };
            if (modField)
                fullMods = JSON.parse(String(modField));
            let mods = {};
            //charges are only added for not required mods
            if (Object.keys(fullMods.notrequired).length)
                mods = fullMods.notrequired;
            // Build charge list with percentage for each mod (null if no percentage)
            chargeList = [];
            for (const modKey in mods) {
                chargeList.push({ key: modKey, charge: mods[modKey].charge, percentage: getChargePercentage(mods[modKey].charge) });
            }
            // Only flat (non-percentage) charges go through the standard charge logic
            const flatMods = {};
            for (const { key, percentage } of chargeList) {
                if (!percentage)
                    flatMods[key] = mods[key];
            }
            log.debug('flat mods', flatMods);
            lineCount = applyStandardCharges(curRecord, line, lineCount, flatMods);
            // Apply percentage-based charges
            //make a unique obj of percentage charges
            for (const { charge, percentage, key } of chargeList) {
                if (percentage)
                    percentageCharges[charge] = percentage;
            }
        }
        for (const charge in percentageCharges) {
            applyPercentageCharge(Number(charge), percentageCharges[charge] || 0, curRecord, !!curRecord.getValue({ fieldId: 'custbody_ah_charges_applied' }));
        }
        curRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true });
    }
});
