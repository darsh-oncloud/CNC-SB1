/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @Author Ariella Hirsch
 * @Title CIA - Cash In Advance
 * @Description Block approval of orders in the UI if the customer has CIA terms and the order is not marked as paid
 * @Motivation CNC would like to switch the default terms from COD (Cash On Delivery) to CIA (Cash In Advance) so as to receive payment sooner and to help with customer expectations
 */
define(["require", "exports", "N/runtime", "N/search", "N/log"], function (require, exports, runtime, search, log) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.pageInit = pageInit;
    exports.saveRecord = saveRecord;
    // import email = require('N/email');
    // import query = require('N/query');
    // The orderstatus changes to pending fulfillment before the record saves
    const pageInitFieldValues = {};
    function pageInit(context) {
        const { currentRecord: curRecord } = context;
        pageInitFieldValues.orderstatus = curRecord.getValue('orderstatus');
    }
    const Terms = {
        CIA: 7
    };
    function saveRecord(context) {
        const curRecord = context.currentRecord;
        const orderstatus = curRecord.getValue({ fieldId: 'orderstatus' });
        const approve = orderstatus === 'B' || curRecord.getValue({ fieldId: 'custbody_yy_so_approve' });
        if (pageInitFieldValues.orderstatus !== 'A' || !approve) {
            return true;
        }
        // Question: Should we use the terms directly from the customer record or disable the terms field on the order?
        let terms = Number(curRecord.getValue({ fieldId: 'terms' }));
        // TODO: Add a comment explaining when this custom field's value changes
        const paid = curRecord.getValue({ fieldId: 'custbody_mb_paid_in_full' });
        const entity = Number(curRecord.getValue('entity'));
        // In case terms is blank on the order (due to BrainTree situations) get the terms from the customer directly
        if (!terms) {
            if (String(curRecord.id) !== 'To Be Generated')
                log.debug(String(curRecord.id), 'Terms Blank');
            const result = search.lookupFields({ type: search.Type.CUSTOMER, id: entity, columns: ['terms'] });
            if (result.terms && result.terms[0]) {
                terms = Number(result.terms[0].value);
            }
        }
        //if not cash in advanced
        if (terms !== 7 || paid || entity === 1781) {
            return true;
        }
        // On create the createddate field does not have a value yet
        const createddate = new Date(Number(curRecord.getValue('createddate')) || new Date());
        if (createddate.getTime() >= new Date('9/2/2025').getTime() || runtime.envType === runtime.EnvType.SANDBOX) { // Planned date for go live
            alert('This order can not be approved until the customer pays.\n(Customer has CIA terms.)' // +
            // 'If you know the cusomter paid but the system is not reflecting it yet, please check the "Paid In Full" field before saving'
            );
            return false;
        }
        return true;
    }
    ;
});
