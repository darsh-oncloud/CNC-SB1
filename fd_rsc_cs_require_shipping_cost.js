/**
 *@NApiVersion 2.0
 *@NScriptType ClientScript
 *@NModuleScope Public
 */
define(["require", "exports"], function (require, exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.pageInit = exports.sublistChanged = exports.fieldChanged = exports.saveRecord = void 0;
    exports.saveRecord = function (c) {
        var shipmethod = c.currentRecord.getValue("shipmethod");
      var freightincluded = c.currentRecord.getValue("custbody16");
        var shippingcost = c.currentRecord.getValue("shippingcost") || 0;
        if (shipmethod == 4640 && shippingcost <= 0 && freightincluded != true) {
            if (confirm('Shipping cost has not been set. Do you want to save?')) {
                return true;
            }
            else {
                return false;
            }
        }
      return true
    };
    exports.fieldChanged = function (c) {
        if (c.fieldId === "handlingcost") {
            window.rsc_handling_cost = c.currentRecord.getValue("handlingcost");
        }
    };
    exports.sublistChanged = function (c) {
        var shippingMethod = c.currentRecord.getValue("shipmethod");
        if (c.sublistId === "item" && shippingMethod == 16) {
            c.currentRecord.setValue("handlingcost", window.rsc_handling_cost);
        }
    };
    exports.pageInit = function (c) {
        window.rsc_handling_cost = c.currentRecord.getValue("handlingcost");
    };
});
