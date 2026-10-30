/**
 * @preserved
 * @NAPIVersion 2.1
 * @NScriptType ClientScript
 * @author Finity - Reuven Brisman
 * @description Shows and alert when you try to add a mainline discount and there already exists a line item discount
**/
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
define(["require", "exports", "N/search", "../libs/ramda"], function (require, exports, search, R) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fieldChanged = void 0;
    var fieldChanged = function (context) {
        var currentRecord = context.currentRecord, fieldId = context.fieldId;
        if (fieldId === "discountrate") {
            var rateValue = currentRecord.getValue("discountrate");
            var lineCount = currentRecord.getLineCount({ sublistId: 'item' });
            if (rateValue && lineCount > 0) {
                var itemsList = R.range(0, lineCount).map(function (line) { return (currentRecord.getSublistValue({ sublistId: 'item', fieldId: "item", line: line })); });
                search.create({
                    type: "discountitem",
                    filters: [
                        ["internalid", "anyof", __spreadArray([], itemsList, true)]
                    ],
                    columns: [
                        "internalid"
                    ]
                }).runPaged.promise({ pageSize: 5 }).then(function (result) {
                    if (result.count > 0) {
                        alert('You cannot add a mainline discount since a line discount already exists');
                        currentRecord.setText({ fieldId: "discountrate", text: "" });
                    }
                });
            }
        }
    };
    exports.fieldChanged = fieldChanged;
});
