/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @Author CNC Dev Team
 * Populate the line lead times for quotes not placed via the UI
 */
define(["require", "exports", "../../cnc_functions.js", "N/runtime", "N/log", "N/record", "./cnc_cl_date_on_line.js"], function (require, exports, cnc_functions_js_1, runtime, log, record, cnc_cl_date_on_line_js_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.beforeSubmit = beforeSubmit;
    exports.beforeLoad = beforeLoad;
    //They have a set lead time depending on collection and don't want any interference with it.
    const leadTimeExemptCustomers = []; //[161136]; //THEHD
    function beforeSubmit(context) {
        const curRecord = context.newRecord;
        let iresponse;
        let ifullDetails;
        //if approving orders like this we need to validate the ship date
        const customer = Number(curRecord.getValue({ fieldId: 'entity' }));
        if (leadTimeExemptCustomers.includes(customer)) {
            return;
        }
        if (context.type === context.UserEventType.APPROVE) {
            const oldRecord = context.oldRecord;
            const oldShipDate = oldRecord.getValue({ fieldId: 'shipdate' });
            const oldboshipdate = oldRecord.getValue({ fieldId: 'custbody_yy_so_bodate' });
            const oldxferdate = oldRecord.getValue({ fieldId: 'custbody_yy_so_xferdate' });
            if (curRecord.type === record.Type.SALES_ORDER) {
                let response;
                let fullDetails;
                populateLeadTimesUE(curRecord, response, fullDetails);
                const status = (0, cnc_cl_date_on_line_js_1.validateShipDate)(curRecord, false, oldShipDate, oldboshipdate, oldxferdate);
                if (status && status.error) {
                    throw new Error(status.message);
                }
            }
        }
        try { // Can remove once we know that the getLeadTime function never throws
            const status = curRecord.getValue('status');
            const orderstatus = curRecord.getValue({ fieldId: 'orderstatus' });
            const tranid = curRecord.getValue({ fieldId: 'tranid' });
            const replacement = curRecord.getValue({ fieldId: 'custbody_yy_so_replacement' });
            // CSV imports can come through with no orderstatus set on the quote (therefore always run on create)
            if (context.type !== context.UserEventType.CREATE && (curRecord.type === record.Type.SALES_ORDER && orderstatus !== 'A' && !(replacement && (!tranid || tranid === 'To Be Generated')) || curRecord.type === record.Type.ESTIMATE && curRecord.getValue('status') !== 'Open')) {
                return;
            }
            if ([runtime.ContextType.CSV_IMPORT, runtime.ContextType.WEBSTORE, runtime.ContextType.MAP_REDUCE].includes(runtime.executionContext) || String(runtime.getCurrentUser().id) === '94242' || (replacement && (!tranid || tranid === 'To Be Generated'))) {
                // TODO: Add lead times for InvtPart so we can include them as well
                var { response, fullDetails } = populateLeadTimesUE(curRecord, iresponse, ifullDetails);
                // log.audit(String(curRecord.id), 'Running Script');
            }
        }
        catch (e) {
            log.error('@beforeSubmit', JSON.stringify({ id: curRecord.id, message: e.message, stack: e.stack }));
            log.error('@beforeSubmit fullDetails', fullDetails);
            log.error('@beforeSubmit response', response);
        }
    }
    function beforeLoad(context) {
        try {
            const { type, form, newRecord: curRecord } = context;
            if (type === context.UserEventType.VIEW && runtime.ContextType.USER_INTERFACE === runtime.executionContext) {
                // Make extended lead times yellow
                // log.debug('defaultValue', form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue);
                // log.debug('typeof defaultValue', typeof form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue);
                // typeof defaultValue returns 'object' if nothing was added to the field yet
                if (typeof form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue == 'object') {
                    form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue = '';
                }
                const lineCount = curRecord.getLineCount('item');
                const lines = Array.from({ length: lineCount }, (_, i) => i).map(line => ({
                    itemtype: String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line })),
                    date: new Date(String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_lead_time', line }))),
                }));
                const dates = lines.map(line => line.date).filter(date => date.toString() !== 'Invalid Date');
                const earliestDate = new Date(dates.sort((a, b) => a.getTime() - b.getTime())[0]).toLocaleDateString();
                form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue += `
            <script>
                let iteration = 0;
                let lines = ${JSON.stringify(lines)};
                console.log(lines, ${JSON.stringify(dates)});
                const interval = setInterval(() => {
                    const leadTimeElems = document.querySelectorAll('[data-ns-tooltip="Item Lead Time"]');
                    for (let i = 0; i < leadTimeElems.length; i++) { //color the date if it's not the earliest one.
                        iteration = 10; // Terminate after loop
                        const elem = leadTimeElems[i];
                        let curDate = elem.innerHTML;
                        console.log(curDate && new Date(curDate).toLocaleDateString(), '${earliestDate}');
                        if (curDate && ['Assembly', 'InvtPart'].includes(lines[i].itemtype) && new Date(curDate).toLocaleDateString() !== '${earliestDate}') {
                            elem.setAttribute('style', 'background-color: #FFFFC0 !important');
                        }
                    }
                    console.log(iteration);
                    iteration++;
                    if (iteration > 9) { clearInterval(interval); }
                }, 500);
            </script>
        `;
                // log.debug('typeof defaultValue', typeof form.getField({ id: 'custbody_nk_view_buildables' }).defaultValue);
            }
        }
        catch (e) {
            log.error('@beforeLoad', e.message);
        }
    }
    function populateLeadTimesUE(curRecord, response, fullDetails) {
        const leadTimeItemTypes = ['Assembly', 'Inventory', 'InvtPart'];
        let mods = {
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
        function getFullLineDetails(curRecord, mods, lines) {
            const linesDetails = lines.map(line => {
                let hasMods = false;
                return {
                    item: curRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line }),
                    itemtype: String(curRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line })),
                    quantity: curRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line }),
                    location: curRecord.getValue('location'),
                    shipmethod: curRecord.getValue('shipmethod'),
                    rush: curRecord.getValue('custbody_mb_so_add_on_accessories'),
                    mods: Object.keys(mods).reduce((acc, val) => {
                        const option = curRecord.getSublistValue({ sublistId: 'item', fieldId: val, line });
                        if (option) {
                            acc[val] = option;
                            hasMods = true;
                        }
                        return acc;
                    }, {}),
                    hasMods,
                    uom: curRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_uom', line }),
                    isclosed: curRecord.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line }),
                    line
                };
            }).filter(line => leadTimeItemTypes.includes(line.itemtype) && !line.isclosed);
            return linesDetails;
        }
        const lineCount = curRecord.getLineCount('item');
        // Don't worry "Iterator.range" is on the way
        const lines = Array.from({ length: lineCount }, (_, i) => i);
        fullDetails = getFullLineDetails(curRecord, mods, lines);
        if (fullDetails.length === 0) {
            return;
        }
        response = (0, cnc_functions_js_1.getLeadTime)(fullDetails);
        let transferdateField = curRecord.getValue({ fieldId: 'custbody_yy_so_xferdate' });
        let transferdate;
        if (transferdateField) {
            transferdate = new Date(String(transferdateField));
        }
        for (const detail of fullDetails) { //if the line has mods then use the mod ship date
            let shipdate = detail.hasMods ? (response[detail.item].modshipdate || response[detail.item].shipdate) : response[detail.item].shipdate;
            if (new Date(shipdate).toString() !== 'Invalid Date') {
                // Date fields can only be set with a Date object (in UE scripts as it may work in client scripts)
                curRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_lead_time', line: detail.line, value: new Date(shipdate) });
            }
            if (response[detail.item].transferDate && !transferdate || response[detail.item].transferDate && response[detail.item].transferDate > transferdate) {
                transferdate = response[detail.item].transferDate;
            }
            else if (response[detail.item].modTransferDate && !transferdate || response[detail.item].modTransferDate && response[detail.item].modTransferDate > transferdate) {
                transferdate = response[detail.item].modTransferDate;
            }
        }
        if (transferdate && curRecord.type === record.Type.SALES_ORDER) {
            curRecord.setValue({ fieldId: 'custbody_yy_so_xferdate', value: transferdate });
            log.audit('transfer date set', transferdate.toLocaleDateString() + curRecord.getValue({ fieldId: 'tranid' }));
        }
        return { response, fullDetails };
    }
});
