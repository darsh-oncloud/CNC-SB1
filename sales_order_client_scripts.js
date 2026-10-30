define(["require", "exports", "N/record", "N/search", "./../../../ah-scripts/uomRequired.js", "../../ah-create-transfers/JavaScripts/dr-dfCL.js"], function (require, exports, record, search, uomRequired_js_1, dr_dfCL_js_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.pageInit = pageInit;
    exports.validateLine = validateLine;
    exports.saveRecord = saveRecord;
    /**
     * @NApiVersion 2.1
     * @NScriptType ClientScript
     * @Author Ariella Hirsch
     * all simple client scripts on sales orders combined
     */
    function pageInit(context) {
        (0, uomRequired_js_1.replacementPageInit)(context);
        return;
    }
    ;
    function validateLine(context) {
        (0, uomRequired_js_1.uomValidateLine)(context);
        if (context.sublistId === 'item' && !alertDoverMods(context))
            return false;
        return true;
    }
    ;
    function saveRecord(context) {
        const rec = context.currentRecord;
        if (rec.type === record.Type.SALES_ORDER) { //for functions that only run on sales orders
            //ciaCLSaveRecord(context);
        }
        (0, dr_dfCL_js_1.drdfSaveRecord)(context);
        return true;
    }
    ;
    function alertDoverMods(context) {
        const rec = context.currentRecord;
        //get the current item being typed
        const item = rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' });
        if (!item)
            return true;
        const options = getOldMods(rec).filter(opt => opt.fieldId !== 'custcol_ap_mod_doversoftclose' && opt.fieldId !== 'custcol_yy_mod_cutdown' && opt.fieldId !== 'custcol_yy_mod_chase' && opt.fieldId !== 'custcol_mb_so_custom_modification'); // blocks all options besides one and Base/Tall Cut To and Chase Cut and Custom Modification
        if (!options.length)
            return true;
        const style = search.lookupFields({
            type: search.Type.ITEM,
            id: item,
            columns: ['custitem_mb_item_style']
        }).custitem_mb_item_style;
        if (!style)
            return;
        if (Number(style[0]?.value) === 32 && options.length) {
            alert('Options are no longer available for Dover items. Please clear options before saving this line.');
            return false;
        }
        return true;
    }
    function getOldMods(record) {
        var raw = record.getCurrentSublistValue({ sublistId: 'item', fieldId: 'options' });
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
});
