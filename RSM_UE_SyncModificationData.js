/**
 * Copyright         RSM US LLP
 * Description       Syncs modification data between the native item option columns and the custom modification JSON column
 * Collaborative Link:  https://rsmnet.sharepoint.com/:w:/r/sites/IWS_CS_eCommDM/ClientDocumentation/CNC%20Cabinetry/Phase%203%20Specs/Technical%20Requirements%20Document%20-%20Modifications%20Refactor.docx?d=wcc2aa0100921424e84be6c9862e3287a&csf=1&web=1&e=P00okE
 * Local Repo Link:     [azure documentation link of final technical doc]
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "./NFT-SS2-8.0.1/EC_Logger", "./NFT-SS2-8.0.1/lodash", "N/query", "N/runtime", "./RSM_Lib_Shared"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.afterSubmit = exports.beforeSubmit = exports.beforeLoad = void 0;
    const EC_Logger_1 = require("./NFT-SS2-8.0.1/EC_Logger");
    const _ = require("./NFT-SS2-8.0.1/lodash");
    const query = require("N/query");
    const runtime = require("N/runtime");
    const RSM_Lib_Shared_1 = require("./RSM_Lib_Shared");
    /**
     * before load entry point - not used by this script
     * @param ctx - context object containing the new and old record
     */
    exports.beforeLoad = (0, EC_Logger_1.autolog)(function beforeLoad(ctx) {
    });
    /**
     * before submit entry point. Webstore orders carry their selections on the native item option
     * columns; everything else carries them in the modification JSON column.
     * @param ctx - context object containing the new and old record
     */
    exports.beforeSubmit = (0, EC_Logger_1.autolog)(function beforeSubmit(ctx) {
        if (ctx.type !== ctx.UserEventType.CREATE && ctx.type !== ctx.UserEventType.COPY && ctx.type !== ctx.UserEventType.EDIT)
            return;
        const rec = ctx.newRecord;
        const lineCount = rec.getLineCount({ sublistId: 'item' });
        if (lineCount <= 0)
            return;
        const modifications = loadModifications();
        if (_.isEmpty(modifications)) {
            EC_Logger_1.DefaultLogger.error('no modifications', 'no active Modification records found - nothing to sync');
            return;
        }
        // SCA orders land as either WEBSTORE or WEBSERVICES
        const isWebstore = _.includes([runtime.ContextType.WEBSTORE, runtime.ContextType.WEBSERVICES], runtime.executionContext);
        _.forEach(_.range(lineCount), (line) => {
            if (isWebstore)
                buildModificationJson(rec, line, modifications);
            else
                applyModificationJson(rec, line, modifications);
        });
    });
    /**
     * after submit entry point - not used by this script
     * @param ctx - context object containing the new and old record
     */
    exports.afterSubmit = (0, EC_Logger_1.autolog)(function afterSubmit(ctx) {
    });
    /**
     * Loads every active Modification and its active Modification Options in one SuiteQL join, keyed
     * for line-level lookup. The left join keeps modifications that have no active options, since the
     * webstore path still needs their column id.
     */
    const loadModifications = (0, EC_Logger_1.autolog)(function loadModifications() {
        const rows = query.runSuiteQL({
            query: `
      SELECT
        m.id AS modification_id,
        m.name AS modification_name,
        m.custrecord_cnc_mod_display_name AS modification_display_name,
        m.custrecord_rsm_native_option_id AS column_id,
        m.custrecord_rsm_is_fft AS is_fft,
        m.custrecord_cnc_mod_required AS is_required,
        o.id AS option_id,
        o.name AS option_name,
        o.custrecord_rsm_native_list_option_id AS list_value_id,
        o.custrecord_cnc_mod_option_charge AS charge_item_id
      FROM customrecord_cnc_modification m
             LEFT JOIN customrecord_cnc_mod_option o
                       ON o.custrecord_cnc_mod_option_parent = m.id
                         AND o.isinactive = 'F'
      WHERE m.isinactive = 'F'
    `
        }).asMappedResults();
        // runSuiteQL caps at 5000 rows - if the join ever reaches that, this needs paging
        if (rows.length >= 5000) {
            EC_Logger_1.DefaultLogger.error('modification query truncated', 'the modification / option join returned 5000 rows - results are incomplete');
        }
        const modifications = {};
        _.forEach(rows, (row) => {
            const modificationId = toText(row.modification_id);
            if (modifications[modificationId] == undefined) {
                modifications[modificationId] = {
                    id: modificationId,
                    name: toText(row.modification_display_name) || toText(row.modification_name),
                    columnId: toText(row.column_id).toLowerCase(),
                    isFreeFormText: isTrue(row.is_fft),
                    isRequired: isTrue(row.is_required),
                    optionsById: {}
                };
            }
            // modifications with no active options come back with a single null-option row
            const optionId = toText(row.option_id);
            if (optionId === '')
                return;
            modifications[modificationId].optionsById[optionId] = {
                id: optionId,
                name: toText(row.option_name),
                listValueId: toText(row.list_value_id),
                chargeItemId: toText(row.charge_item_id)
            };
        });
        return modifications;
    }, { withGovernance: true, withProfiling: true });
    /**
     * Webstore path: turn the native item option columns that arrived with data on this line into the
     * custom modification JSON, in the same shape CNC writes when a modification is entered on an order.
     * @param rec - the transaction being submitted
     * @param line - item line index
     * @param modifications - active modifications keyed by internal id
     */
    const buildModificationJson = (0, EC_Logger_1.autolog)(function buildModificationJson(rec, line, modifications) {
        const required = {};
        const notrequired = {};
        _.forEach(modifications, (modification) => {
            var _a, _b;
            if (modification.columnId === '')
                return;
            const value = readColumn(rec, line, modification.columnId);
            if (value === '')
                return;
            // getSublistText is not available in beforeSubmit - the option name comes from the config map,
            // which RSM_UE_ModificationOption keeps in step with the list value's name
            const option = findOptionForColumnValue(modification, value);
            if (option == undefined && !modification.isFreeFormText) {
                EC_Logger_1.DefaultLogger.error(`line ${line} unmapped item option`, `column "${modification.columnId}" holds list value ${value}, which no active Modification Option under "${modification.name}" maps to`);
            }
            const entry = {
                modName: modification.name,
                optId: Number((_a = option === null || option === void 0 ? void 0 : option.id) !== null && _a !== void 0 ? _a : 0),
                // free-form columns carry the typed text itself; list columns carry the option's name
                // free-form columns hold the typed text as their value; list columns map to the option's name
                optName: modification.isFreeFormText ? mapFreeFormTextValues(modification.columnId, value, true) : toText(option === null || option === void 0 ? void 0 : option.name),
                charge: Number((_b = option === null || option === void 0 ? void 0 : option.chargeItemId) !== null && _b !== void 0 ? _b : 0)
            };
            if (modification.isRequired)
                required[modification.id] = entry;
            else
                notrequired[modification.id] = entry;
        });
        if (_.isEmpty(required) && _.isEmpty(notrequired))
            return;
        const modificationJson = JSON.stringify({ required, notrequired });
        EC_Logger_1.DefaultLogger.error(`line ${line} modification json`, modificationJson);
        rec.setSublistValue({ sublistId: 'item', fieldId: 'custcol_cnc_so_mod_json', line, value: modificationJson });
    }, { withGovernance: true });
    /**
     * Finds the Modification Option that a column value came from. List-backed columns hold the option's
     * mapped list value id; a free-form modification has a single option shell, so that one is used.
     * @param modification - the modification owning the column
     * @param value - raw value read off the item option column
     */
    const findOptionForColumnValue = function findOptionForColumnValue(modification, value) {
        if (!modification.isFreeFormText) {
            return _.find(modification.optionsById, (option) => option.listValueId === value);
        }
        const options = _.values(modification.optionsById);
        return options.length === 1 ? options[0] : undefined;
    };
    /**
     * Non-webstore path: read the modification JSON on this line and set the native item option column
     * for each modification it names.
     * @param rec - the transaction being submitted
     * @param line - item line index
     * @param modifications - active modifications keyed by internal id
     */
    const applyModificationJson = (0, EC_Logger_1.autolog)(function applyModificationJson(rec, line, modifications) {
        const rawJson = toText(rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_cnc_so_mod_json', line }));
        if (rawJson === '')
            return;
        let parsed;
        try {
            parsed = JSON.parse(rawJson);
        }
        catch (e) {
            // a malformed column should not stop the order from saving
            EC_Logger_1.DefaultLogger.error(`line ${line} modification json`, `could not parse custcol_cnc_so_mod_json: ${rawJson}`);
            return;
        }
        _.forEach([parsed.required, parsed.notrequired], (group) => {
            _.forEach(group, (entry, modificationId) => {
                applyJsonEntry(rec, line, modifications, modificationId, entry);
            });
        });
    }, { withGovernance: true });
    /**
     * Sets one item option column from one modification JSON entry.
     * @param rec - the transaction being submitted
     * @param line - item line index
     * @param modifications - active modifications keyed by internal id
     * @param modificationId - internal id of the Modification, taken from the JSON key
     * @param entry - the JSON entry describing the chosen option
     */
    const applyJsonEntry = function applyJsonEntry(rec, line, modifications, modificationId, entry) {
        var _a;
        const modification = modifications[toText(modificationId)];
        if (modification == undefined) {
            EC_Logger_1.DefaultLogger.error(`line ${line} unknown modification`, `modification ${modificationId} ("${entry.modName}") is not an active Modification`);
            return;
        }
        if (modification.columnId === '') {
            EC_Logger_1.DefaultLogger.error(`line ${line} missing item option column`, `modification ${modification.id} ("${modification.name}") has no item option column id`);
            return;
        }
        // free-form text options carry the text itself; list-backed options map the option to its list value id
        const value = modification.isFreeFormText ? mapFreeFormTextValues(modification.columnId, toText(entry.optName), false) : toText((_a = modification.optionsById[toText(entry.optId)]) === null || _a === void 0 ? void 0 : _a.listValueId);
        if (value === '') {
            EC_Logger_1.DefaultLogger.error(`line ${line} unmapped option`, `option ${entry.optId} ("${entry.optName}") has no value to write to column "${modification.columnId}"`);
            return;
        }
        try {
            rec.setSublistValue({ sublistId: 'item', fieldId: modification.columnId, line, value });
        }
        catch (e) {
            EC_Logger_1.DefaultLogger.error(`line ${line} could not set ${modification.columnId}`, `setting "${value}" failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
    /**
     * Reads an item option column, treating a column the record does not expose as empty rather than
     * letting it stop the sync.
     * @param rec - the transaction being submitted
     * @param line - item line index
     * @param columnId - item option column script id
     */
    const readColumn = function readColumn(rec, line, columnId) {
        try {
            return toText(rec.getSublistValue({ sublistId: 'item', fieldId: columnId, line }));
        }
        catch (e) {
            return '';
        }
    };
    /**
     * Normalizes a search or field value to a trimmed string ('' when empty).
     * @param value - raw value
     */
    const toText = function toText(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    };
    /**
     * Reads a checkbox from a search result, which arrives as a boolean or as 'T' / 'F'.
     * @param value - raw value
     */
    const isTrue = function isTrue(value) {
        return value === true || toText(value).toUpperCase() === 'T';
    };
    const mapFreeFormTextValues = function mapFreeFormTextValues(optionid, value, toCustom) {
        const MEASUREMENT_MOD_IDS = [
            'custcol_mb_so_cntp_size',
            'custcol_mb_so_cut_down_extend',
            'custcol_mb_so_first_inches_to_center',
            'custcol_mb_so_second_inches_to_center'
        ];
        if (MEASUREMENT_MOD_IDS.indexOf(optionid) >= 0) {
            return toCustom ? (0, RSM_Lib_Shared_1.changeCountertopMeasurementToFraction)(value) : (0, RSM_Lib_Shared_1.changeCountertopMeasurementToDecimal)(value);
        }
        return value;
    };
});
