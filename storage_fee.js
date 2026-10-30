define(["require", "exports", "N/query", "N/log"], function (require, exports, query, log) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.beforeSubmit = beforeSubmit;
    /**
     * @NApiVersion 2.1
     * @NScriptType UserEventScript
     * @NModuleScope Public
     */
    const STORAGE_FEE_AMOUNT = 25; // per day
    const FREE_DAYS = 3;
    const OVERRIDE_CHECKBOX = 'custbody_storage_fee_override';
    const STORAGE_FEE_ITEM = '399590';
    function beforeSubmit(context) {
        try {
            if (context.type !== context.UserEventType.EDIT) {
                return;
            }
            const so = context.newRecord;
            // Exit on Pending Approval, Billed, or Closed
            const orderstatus = String(so.getValue({ fieldId: 'orderstatus' }));
            if (['A', 'G', 'H'].includes(orderstatus)) {
                return;
            }
            // Storage fee only applies to recent orders
            const createddate = (new Date(Number(so.getValue({ fieldId: 'createddate' }))) || new Date()).getTime();
            if (createddate < new Date('3/5/2026').getTime()) {
                return;
            }
            // Skip if at any point ship dates were changed without customer input (as of the last conversation this would suffice (for now)).
            const oldRecord = context.oldRecord;
            if (!oldRecord)
                return; // TS appease as this does not run on create
            const oldShipDate = oldRecord.getValue({ fieldId: 'shipdate' });
            const newShipDate = so.getValue({ fieldId: 'shipdate' });
            if (!(newShipDate instanceof Date) || !(oldShipDate instanceof Date))
                return;
            // Storage fee should only get applied when the ship date changes so that it can be removed or adjusted manually (and so that we don't need to make sure it does not add a new fee every time it saves).
            if (oldShipDate.toLocaleDateString() == newShipDate.toLocaleDateString()) {
                return;
            }
            // For context, this field checks in a client script and unchecks in an after submit workflow
            const custbody_yy_so_datechange_cust = so.getValue({ fieldId: 'custbody_yy_so_datechange_cust' });
            if (!custbody_yy_so_datechange_cust) {
                so.setValue({ fieldId: 'custbody_so_internal_ship_date_change', value: true });
            }
            // Per Amarilis on 4/28/2026 exclude replacement orders from the fee. (If we messed up on a customer's orders we want them to have the flexibility to pick it up whenever.)
            const custbody_yy_so_replacement = so.getValue('custbody_yy_so_replacement');
            if (custbody_yy_so_replacement) {
                return;
            }
            // Per Jeniffer in an email she sent Nachman on 1/29, exclude the customer MANS from the fee, on 4/10 she asked to exclude more customers
            const entity = Number(so.getValue('entity'));
            const customer = String(so.getText('entity'));
            if ([129335, 203264, 161136, 1117, 1169, 41910, 109559, 87232, 150654].includes(entity) || customer.startsWith('LPS :')) { // MANS, MANS-GRAND RAPIDS, THEHD, HDSUP, HDSUP : PRO, HDSUP : CHUB, HDSUP : SPECIAL, HDSUP : HDSUPL, LOWES, "LPS :"
                return;
            }
            ;
            // Skip if manual override is checked
            if (so.getValue({ fieldId: OVERRIDE_CHECKBOX }) === true) {
                return;
            }
            const custbody_so_internal_ship_date_change = so.getValue({ fieldId: 'custbody_so_internal_ship_date_change' });
            if (custbody_so_internal_ship_date_change) {
                return;
            }
            // Retrieve Ship Dates (compare the cutoff ship date to the current ship date)
            let approvedShipDate = so.getValue({ fieldId: 'custbody_so_storage_fee_ship_date' });
            if (!approvedShipDate || !newShipDate) {
                return; // missing data; skip
            }
            // A storage exemption specific to the storage fee UI popup. I would've preferred using Internal Ship Date Change but that field supposedly has multipurpose. (Rumors tell of a report that shows when production is responsible for delays.)        
            // Can use a custom dropdown field with the waiver reasons but I don't want to add more noise to the records and system notes.
            // A custom dropdown field would also cause a (probably negligible) slowdown as portion of the NetSuite slowness comes from all the custom dropdown fields that preload their custom lists.)
            // I would like to use a separate record for storage fee waivers and corresponding orders but that means we'd have to load the record for orders that may be subject to storage fees.
            // For now I have this JSON field. The field does not show up in system notes because it's not on the form (only the record).
            try {
                const custbody_nk_json = JSON.parse(String(so.getValue({ fieldId: 'custbody_nk_json' })));
                if (custbody_nk_json?.waiver) {
                    return;
                }
            }
            catch (e) {
                log.error('@JSON.parse', e.message);
            }
            approvedShipDate = new Date(String(approvedShipDate));
            const currentPreferredShipDate = new Date(String(newShipDate));
            // Calculate business-day delay
            const delayedDays = businessDaysBetween(approvedShipDate, currentPreferredShipDate);
            log.debug('delayedDays', delayedDays);
            // Free 3 days
            const billableDays = Math.max(0, delayedDays - FREE_DAYS);
            if (billableDays <= 0) {
                return; // no charge applies
            }
            applyStorageFee(so, billableDays);
        }
        catch (e) {
            log.error('@beforeSubmit', e.message + ' stack: ' + e.stack);
        }
    }
    ;
    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================
    function businessDaysBetween(start, target, blackoutDates) {
        if (!blackoutDates) {
            const blackout = query.runSuiteQL({
                query: `
                SELECT TO_DATE(custrecord13) AS date, custrecord_ah_truckschedule AS days 
                FROM customrecord_yy_blackout
                WHERE custrecord13 > CURRENT_DATE
        `
            }).asMappedResults();
            blackoutDates = {};
            for (let i = 0; i < blackout.length; i++) { //get all the blackout dates
                blackoutDates[String(blackout[i]['date'])] = blackout[i].days;
            }
        }
        let today = new Date(start), targetDate = new Date(target), numdays = 0;
        // Remove the extra milliseconds
        today = new Date(today.toLocaleDateString());
        today.setDate(today.getDate() + 1);
        while (today <= targetDate) {
            let wd = today.getDay(), ds = today.toLocaleDateString();
            if (wd && wd !== 6 && !Object.keys(blackoutDates).includes(ds))
                numdays++;
            today.setDate(today.getDate() + 1);
        }
        return numdays;
    }
    function applyStorageFee(so, days) {
        const feeAmount = Math.min(days * STORAGE_FEE_AMOUNT, 250);
        const lineCount = so.getLineCount({ sublistId: 'item' });
        // Check if fee already exists → update it
        for (let i = 0; i < lineCount; i++) {
            if (so.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }) == STORAGE_FEE_ITEM) {
                so.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: i,
                    value: feeAmount
                });
                return;
            }
        }
        // Insert new fee line
        so.insertLine({ sublistId: 'item', line: lineCount });
        so.setSublistValue({ sublistId: 'item', fieldId: 'item', line: lineCount, value: STORAGE_FEE_ITEM });
        so.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: lineCount, value: 1 });
        so.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: lineCount, value: feeAmount });
        log.audit('Storage Fee Applied', so.id);
    }
});
