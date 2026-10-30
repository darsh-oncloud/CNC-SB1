/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * 
 * Description: Replaces placeholder items on Sales Orders based on centralized Custom Record rules 
 * for prefixes, and a JSON Script Parameter for line options.
 */
define(['N/search', 'N/record', 'N/log', 'N/runtime'], function (search, record, log, runtime) {

    const CONFIG = {
        IDS: {
            CUSTOMER_BOOMI: '161136',
            ITEM_PLACEHOLDER: '429828',
            ITEM_PLACEHOLDER_ALT: '306263',
            ITEM_PLACEHOLDER_ALT2: '430428',
            ITEM_EDI_PRODUCT_SERVICE: '1013534250'
        },
        FIELDS: {
            ITEM_TAG: 'custcol_rsm_item_tag',
            EDI_ITEM_NAME: 'custcol_boomi_edi_item_name',
            PRODUCT_SERVICE_ID: 'custcol_product_service_id',
            PLUS_POINT_COLOR: 'custcol_yy_mod_cplus_color',
            PLUS_STAIN_COLOR: 'custcol_er_mod_cplus_stain',
            MOD_TOEKICK: 'custcol_yy_mod_toekick',
            EDI_MTX: 'custbody_edi_850_mtx'
        },
        CUSTOM_RECORD: {
            TYPE: 'customrecord_edi_item_mapping',
            FIELDS: {
                ITEM_TAG: 'custrecord_item_tag',
                MTX_MATCH: 'custrecord_edi_850_mtx_match',
                PREFIX_OUTPUT: 'custrecord_prefix_output'
            }
        },
        CUSTOM_LISTS: {
            POINT_COLOR: 'customlist_yy_cplus_color',
            STAIN_COLOR: 'customlist_er_cplus_stain'
        },
        VALUES: {
            TOEKICK_REMOVE_OPT: '2'
        }
    };

    const STAIN_PREFIXES = ['VKMP-', 'WKMP-', 'NKP-', 'SKP-'];
    const PAINT_PREFIXES = ['VBMP-', 'WBMP-', 'HBMP-', 'EBP-', 'NBP-', 'FBP-', 'SBP-', 'RBP-'];
    const ALL_YELLOW_PREFIXES = STAIN_PREFIXES.concat(PAINT_PREFIXES);

    // Loads mapping rules from Custom Record
    function getPrefixMappingRules() {
        var rules = [];
        try {
            var mappingSearch = search.create({
                type: CONFIG.CUSTOM_RECORD.TYPE,
                filters: ['isinactive', 'is', 'F'],
                columns: [
                    CONFIG.CUSTOM_RECORD.FIELDS.ITEM_TAG,
                    search.createColumn({ name: CONFIG.CUSTOM_RECORD.FIELDS.MTX_MATCH, sort: search.Sort.DESC }),
                    CONFIG.CUSTOM_RECORD.FIELDS.PREFIX_OUTPUT
                ]
            });
            mappingSearch.run().each(function (result) {
                rules.push({
                    itemTag: result.getValue(CONFIG.CUSTOM_RECORD.FIELDS.ITEM_TAG),
                    mtxContains: (result.getValue(CONFIG.CUSTOM_RECORD.FIELDS.MTX_MATCH) || '').toUpperCase(),
                    prefix: result.getValue(CONFIG.CUSTOM_RECORD.FIELDS.PREFIX_OUTPUT)
                });
                return true;
            });

            // Sort rules so that rules with specific MTX matches are evaluated before default (empty) rules
            rules.sort(function (a, b) {
                var aHasMtx = a.mtxContains ? 1 : 0;
                var bHasMtx = b.mtxContains ? 1 : 0;
                return bHasMtx - aHasMtx;
            });

            // If the custom record doesn't exist yet, we catch the error gracefully
        } catch (e) {
            log.error('Error loading Custom Record rules', e.message);
        }
        return rules;
    }



    function afterSubmit(context) {
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) return;

        try {
            var newRec = context.newRecord;
            var soId = newRec.id;
            const recType = newRec.type;
            const orderStatus = newRec.getValue({ fieldId: 'orderstatus' });

            log.audit('afterSubmit Triggered', 'SO/Estimate ID: ' + soId + ' | Type: ' + recType + ' | Event: ' + context.type);

            if (recType === record.Type.SALES_ORDER && orderStatus !== 'A') {
                log.debug('Skipping record - not Pending Approval', 'Status: ' + orderStatus);
                return;
            }

            var customerId = newRec.getValue('entity');
            if (customerId != CONFIG.IDS.CUSTOMER_BOOMI) {
                log.debug('Skipping record - Customer is not Boomi EDI (' + CONFIG.IDS.CUSTOMER_BOOMI + ')', 'Customer: ' + customerId);
                return;
            }

            // Run Saved Search to identify which Boomi EDI Items meet the specific criteria
            var validEdiNames = {};
            var results = search.create({
                type: recType,
                filters: [
                    ["type", "anyof", "SalesOrd", "Estimate"], "AND",
                    ["name", "anyof", CONFIG.IDS.CUSTOMER_BOOMI], "AND",
                    ["mainline", "is", "F"], "AND",
                    ["internalidnumber", "equalto", soId], "AND",
                    ["status", "anyof", "SalesOrd:A"], "AND",
                    [
                        [
                            [
                                ["item.custitem_yy_availableso", "is", "T"], "OR",
                                ["item.type", "anyof", "Discount", "Kit", "Markup", "NonInvtPart", "OthCharge", "Subtotal"]
                            ], "AND",
                            ["item.custitem14", "doesnotcontain", "Check transactions"], "AND",
                            ["item.isinactive", "is", "F"], "AND",
                            ["item.custitem_mb_cncproductline", "noneof", "26"], "AND",
                            ["item.custitem_mb_item_group", "noneof", "7"], "AND",
                            ["item.custitem_yy_launchdate", "notafter", "today"], "AND",
                            ["item.custitem_yy_it_priceonly", "is", "F"]
                        ],
                        "OR",
                        ["item", "anyof", CONFIG.IDS.ITEM_PLACEHOLDER, CONFIG.IDS.ITEM_PLACEHOLDER_ALT, CONFIG.IDS.ITEM_PLACEHOLDER_ALT2]
                    ]
                ],
                columns: [
                    search.createColumn({ name: CONFIG.FIELDS.EDI_ITEM_NAME })
                ]
            }).run().getRange({ start: 0, end: 1000 });

            for (var i = 0; i < results.length; i++) {
                var ediNameSearch = results[i].getValue({ name: CONFIG.FIELDS.EDI_ITEM_NAME });
                if (ediNameSearch) {
                    validEdiNames[ediNameSearch] = true;
                }
            }
            log.debug('Validated Boomi EDI Names', JSON.stringify(validEdiNames));

            // Find all matching lines directly from the record instead of doing a saved search loop
            // Since we need Boomi EDI Item Name and Tag for all lines anyway, it's safer to load the record.
            var rec = record.load({
                type: recType,
                id: soId,
                isDynamic: true
            });

            let is5P = rec.getValue('custbody_yy_so_5pdf');
            let mtxField = (rec.getValue(CONFIG.FIELDS.EDI_MTX) || '').toUpperCase();
            let forceMilano = mtxField.indexOf('MILANO') !== -1 && mtxField.indexOf('MIRAGE') !== -1;

            log.debug('Record successfully loaded', 'is5P: ' + is5P + ' | forceMilano: ' + forceMilano + ' | mtx: ' + mtxField);

            if (!is5P && recType == record.Type.ESTIMATE) {
                log.debug('Skipping Estimate - is5P is false');
                return;
            }

            var lineCount = rec.getLineCount({ sublistId: 'item' });
            var linesToRemove = [];

            // Pre-process: Handle BFP-L and BFP-R finish items
            log.debug('Pre-processing BFP Finish suffixes', 'Total lines to scan: ' + lineCount);
            for (var k = lineCount - 1; k >= 0; k--) {
                var ediName = (rec.getSublistValue({ sublistId: 'item', fieldId: CONFIG.FIELDS.EDI_ITEM_NAME, line: k }) || '').toUpperCase();
                if (ediName === 'BFP-L' || ediName === 'BFP-R') {
                    // Search upwards for the first non-BFP line (the actual cabinet)
                    var targetIndex = -1;
                    for (var u = k - 1; u >= 0; u--) {
                        var upEdiName = (rec.getSublistValue({ sublistId: 'item', fieldId: CONFIG.FIELDS.EDI_ITEM_NAME, line: u }) || '').toUpperCase();
                        if (upEdiName !== 'BFP-L' && upEdiName !== 'BFP-R' && upEdiName !== '') {
                            targetIndex = u;
                            break;
                        }
                    }

                    if (targetIndex !== -1) {
                        var prevEdiName = rec.getSublistValue({ sublistId: 'item', fieldId: CONFIG.FIELDS.EDI_ITEM_NAME, line: targetIndex }) || '';
                        var suffix = (ediName === 'BFP-L') ? '-FL' : '-FR';

                        // If previous line already has a finish suffix, combine or upgrade to -F2 (both sides)
                        if (prevEdiName.indexOf('-FL') !== -1 || prevEdiName.indexOf('-FR') !== -1) {
                            if ((ediName === 'BFP-L' && prevEdiName.indexOf('-FR') !== -1) ||
                                (ediName === 'BFP-R' && prevEdiName.indexOf('-FL') !== -1)) {
                                prevEdiName = prevEdiName.replace(/-FL|-FR/g, '') + '-F2';
                            }
                        } else if (prevEdiName.indexOf('-F2') === -1) {
                            prevEdiName += suffix;
                        }

                        let targetPrice = rec.getSublistValue({ sublistId: 'item', fieldId: 'price', line: targetIndex });
                        let targetRate = rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: targetIndex });
                        let targetQty = rec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: targetIndex });
                        let targetAmount = rec.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: targetIndex });

                        rec.selectLine({ sublistId: 'item', line: targetIndex });
                        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: CONFIG.FIELDS.EDI_ITEM_NAME, value: prevEdiName });

                        if (targetPrice !== null && targetPrice !== undefined && targetPrice !== '') {
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: targetPrice });
                        }
                        if (targetRate !== null && targetRate !== undefined && targetRate !== '') {
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: targetRate });
                        }
                        if (targetQty !== null && targetQty !== undefined && targetQty !== '') {
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: targetQty });
                        }
                        if (targetAmount !== null && targetAmount !== undefined && targetAmount !== '') {
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: targetAmount });
                        }
                        rec.commitLine({ sublistId: 'item' });
                        log.debug('Applied BFP finish suffix', 'Line ' + targetIndex + ' updated to: ' + prevEdiName);
                    }
                    linesToRemove.push(k);
                }
            }

            // Remove BFP lines
            linesToRemove.forEach(function (index) {
                rec.removeLine({ sublistId: 'item', line: index });
            });

            // Re-calculate line count after removals
            lineCount = rec.getLineCount({ sublistId: 'item' });

            // Load Mapping Data
            var prefixRules = getPrefixMappingRules();

            // Load Custom Color and Stain Lists dynamically from NetSuite
            var colorsMap = loadCustomList(CONFIG.CUSTOM_LISTS.POINT_COLOR);
            var stainsMap = loadCustomList(CONFIG.CUSTOM_LISTS.STAIN_COLOR);

            log.debug('Scanning line items for mapping', 'Lines to scan: ' + lineCount);

            for (var j = 0; j < lineCount; j++) {
                var itemId = rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: j });
                let originalEdiItemName = rec.getSublistValue({ sublistId: 'item', fieldId: CONFIG.FIELDS.EDI_ITEM_NAME, line: j });
                let itemTag = rec.getSublistValue({ sublistId: 'item', fieldId: CONFIG.FIELDS.ITEM_TAG, line: j });

                if (!originalEdiItemName) continue;

                // Ensure this line's EDI name was found in the search results that validate item criteria
                let nameToCheck = originalEdiItemName.replace(/-FL|-FR|-F2/g, '');
                if (!validEdiNames[originalEdiItemName] && !validEdiNames[nameToCheck]) continue;

                if (context.type === context.UserEventType.EDIT) {
                    var isPlaceholder = parseInt(itemId) === parseInt(CONFIG.IDS.ITEM_PLACEHOLDER) ||
                                        parseInt(itemId) === parseInt(CONFIG.IDS.ITEM_PLACEHOLDER_ALT) ||
                                        parseInt(itemId) === parseInt(CONFIG.IDS.ITEM_PLACEHOLDER_ALT2);
                    if (!isPlaceholder) {
                        continue;
                    }
                }

                log.audit('Processing matching line ' + j, 'Item ID: ' + itemId + ' | EDI Name: ' + originalEdiItemName + ' | Tag: ' + itemTag);

                // Capture original line pricing, quantity, and amount before any edits
                let originalQty = rec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: j });
                let originalRate = rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: j });
                let originalPrice = rec.getSublistValue({ sublistId: 'item', fieldId: 'price', line: j });
                let originalAmount = rec.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: j });

                // Strip any existing prefix from the EDI item name
                let cleanedEdiItemName = stripExistingPrefix(originalEdiItemName, prefixRules);
                let ediItemName = cleanedEdiItemName;

                // Extract base name logic based on universal naming conventions
                let baseEdiName = cleanedEdiItemName;
                if (/^CW[0-9]+[LR]$/.test(cleanedEdiItemName)) {
                    baseEdiName = cleanedEdiItemName.match(/^CW[0-9]+/)[0];
                } else if (/^[0-9]+[A-Z]$/.test(cleanedEdiItemName)) {
                    baseEdiName = cleanedEdiItemName.match(/^[0-9]+/)[0];
                }

                // 1. Resolve Prefix from Custom Record (try exact match first, then substring match)
                let prefix = null;
                let matchedMtx = null;
                for (var r = 0; r < prefixRules.length; r++) {
                    var rule = prefixRules[r];
                    var ruleItemTagUpper = (rule.itemTag || '').toUpperCase();
                    var lineItemTagUpper = (itemTag || '').toUpperCase();
                    if (ruleItemTagUpper && (lineItemTagUpper === ruleItemTagUpper || lineItemTagUpper.indexOf(ruleItemTagUpper) !== -1)) {
                        if (!rule.mtxContains || mtxField.indexOf(rule.mtxContains) !== -1) {
                            prefix = rule.prefix;
                            matchedMtx = rule.mtxContains;
                            break; // Stop at first matched rule
                        }
                    }
                }

                // Fallback: If prefix couldn't be resolved, try to extract it directly from the itemTag description
                if (!prefix && itemTag) {
                    var tagMatch = itemTag.match(new RegExp('\\b([A-Z0-9]+-)' + baseEdiName + '\\b', 'i')) || 
                                   itemTag.match(new RegExp('\\b([A-Z0-9]+-)' + cleanedEdiItemName + '\\b', 'i'));
                    if (tagMatch) {
                        prefix = tagMatch[1].toUpperCase();
                        log.debug('Extracted Prefix from Item Tag', 'Prefix: ' + prefix + ' | Match: ' + tagMatch[0]);
                    }
                }

                log.debug('Resolved Prefix for line ' + j, 'Prefix: ' + prefix + ' | matchedMtx: ' + matchedMtx);

                let transformedName = null;
                if (prefix) {
                    if (!cleanedEdiItemName.startsWith(prefix)) {
                        ediItemName = prefix + cleanedEdiItemName; // Original behavior in the script for setting the column
                        transformedName = prefix + baseEdiName;
                    } else {
                        transformedName = baseEdiName;
                    }
                } else {
                    transformedName = cleanedEdiItemName;
                }

                if (forceMilano && originalEdiItemName !== 'BFP-R' && originalEdiItemName !== 'BFP-L') {
                    if (!originalEdiItemName.startsWith('MPM450-')) {
                        transformedName = 'MPM450-' + originalEdiItemName;
                    }
                }

                if (!transformedName) continue;
                transformedName = transformedName.split(' ')[0];

                // If no prefix was set but we transformed the name, set the EDI column (matches old logic)
                rec.selectLine({ sublistId: 'item', line: j });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: CONFIG.FIELDS.EDI_ITEM_NAME, value: ediItemName });
                log.debug('Assembled transformed name', 'Line: ' + j + ' | Transformed: ' + transformedName + ' | EDI Column Value: ' + ediItemName);

                if (originalPrice !== null && originalPrice !== undefined && originalPrice !== '') {
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: originalPrice });
                }
                if (originalRate !== null && originalRate !== undefined && originalRate !== '') {
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: originalRate });
                }
                if (originalQty !== null && originalQty !== undefined && originalQty !== '') {
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: originalQty });
                }
                if (originalAmount !== null && originalAmount !== undefined && originalAmount !== '') {
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: originalAmount });
                }

                // 2. Set Plus Series options dynamically from custom lists
                applyColorOptions(rec, prefix, matchedMtx, itemTag, stainsMap, colorsMap, mtxField);
                rec.commitLine({ sublistId: 'item' });

                // Product Service 5P logic
                let productServiceId = rec.getSublistValue({
                    sublistId: 'item',
                    fieldId: CONFIG.FIELDS.PRODUCT_SERVICE_ID,
                    line: j
                });

                if (productServiceId == CONFIG.IDS.ITEM_EDI_PRODUCT_SERVICE && ediItemName) {
                    log.audit('Line matches 5P Product Service ID', 'Line: ' + j + ' | Product Service ID: ' + productServiceId);
                    let firstPart = ediItemName.split(' ')[0];
                    let updatedName = firstPart + '-5P';

                    if (is5P) {
                        const itemExists = getItemIdByName(updatedName);
                        if (itemExists) {
                            rec.selectLine({ sublistId: 'item', line: j });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemExists });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1 });
                            if (originalQty !== null && originalQty !== undefined && originalQty !== '') {
                                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: originalQty });
                            }
                            if (originalRate !== null && originalRate !== undefined && originalRate !== '') {
                                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: originalRate });
                            }
                            if (originalAmount !== null && originalAmount !== undefined && originalAmount !== '') {
                                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: originalAmount });
                            }

                            // Re-apply options dynamically for 5p item
                            applyColorOptions(rec, prefix, matchedMtx, itemTag, stainsMap, colorsMap, mtxField);

                            rec.commitLine({ sublistId: 'item' });
                            log.audit('Replaced with 5P Item', 'Line: ' + j + ' | Item ID: ' + itemExists + ' | Name: ' + updatedName);
                        }
                    } else {
                        let itemIdIs = getItemIdByName(firstPart);
                        if (itemIdIs) {
                            rec.selectLine({ sublistId: 'item', line: j });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemIdIs });
                            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1 });
                            if (originalQty !== null && originalQty !== undefined && originalQty !== '') {
                                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: originalQty });
                            }
                            if (originalRate !== null && originalRate !== undefined && originalRate !== '') {
                                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: originalRate });
                            }
                            if (originalAmount !== null && originalAmount !== undefined && originalAmount !== '') {
                                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: originalAmount });
                            }

                            // Re-apply options dynamically
                            applyColorOptions(rec, prefix, matchedMtx, itemTag, stainsMap, colorsMap, mtxField);

                            rec.commitLine({ sublistId: 'item' });
                        }
                    }
                    continue; // Done handling 5p logic
                }

                // Standard item replacement
                let newItemId;
                if (is5P) {
                    const transformedName5p = transformedName + '-5P';
                    const id5p = getItemIdByName(transformedName5p);

                    if (!id5p) {
                        newItemId = getItemIdByName(transformedName);
                    } else {
                        newItemId = id5p;
                    }
                } else {
                    newItemId = getItemIdByName(transformedName);
                }

                if (!newItemId) {
                    log.error('Item not found for transformed name', transformedName);
                    continue;
                }

                rec.selectLine({ sublistId: 'item', line: j });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: newItemId });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: -1 });
                if (originalQty !== null && originalQty !== undefined && originalQty !== '') {
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: originalQty });
                }
                if (originalRate !== null && originalRate !== undefined && originalRate !== '') {
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: originalRate });
                }
                if (originalAmount !== null && originalAmount !== undefined && originalAmount !== '') {
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: originalAmount });
                }

                if (originalEdiItemName === 'MCB3024' || cleanedEdiItemName === 'MCB3024') {
                    try {
                        rec.setCurrentSublistValue({ sublistId: 'item', fieldId: CONFIG.FIELDS.MOD_TOEKICK, value: CONFIG.VALUES.TOEKICK_REMOVE_OPT });
                        log.debug('Applied MCB3024 toekick modification option');
                    } catch (e) { }
                }

                // Re-apply options dynamically
                applyColorOptions(rec, prefix, matchedMtx, itemTag, stainsMap, colorsMap, mtxField);

                rec.commitLine({ sublistId: 'item' });
                log.audit('Line Item Replacement Completed', 'Line: ' + j + ' | New Item ID: ' + newItemId + ' | Transformed Name: ' + transformedName);
            }

            rec.save();
            log.audit('Sales Order successfully saved with transformed items', soId);

        } catch (e) {
            log.error('Script Error', e);
        }
    }

    function getItemIdByName(name) {
        try {
            var res = search.create({
                type: search.Type.ITEM,
                filters: [
                    ['itemid', 'is', name], 'AND',
                    ['isinactive', 'is', 'F']
                ],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });

            return res.length > 0 ? res[0].getValue('internalid') : null;
        } catch (e) {
            log.error('getItemIdByName error', e.message);
            return null;
        }
    }



    function loadCustomList(listId) {
        var listMap = {};
        try {
            search.create({
                type: listId,
                filters: [['isinactive', 'is', 'F']],
                columns: ['internalid', 'name']
            }).run().each(function (result) {
                var id = result.getValue('internalid');
                var name = result.getValue('name').toUpperCase();
                listMap[name] = id;
                return true;
            });
        } catch (e) {
            log.error('Failed to load custom list ' + listId, e.message);
        }
        return listMap;
    }

    function findListId(listMap, finishName) {
        if (!finishName) return null;
        var finishUpper = finishName.toUpperCase();
        for (var key in listMap) {
            var regex = new RegExp('\\b' + finishUpper + '\\b');
            if (regex.test(key)) {
                return listMap[key];
            }
        }
        return null;
    }

    function stripExistingPrefix(name, prefixRules) {
        if (!name) return "";
        
        // Temporarily isolate finish suffix if present
        var suffixMatch = name.match(/-FL$|-FR$|-F2$/i);
        var suffix = suffixMatch ? suffixMatch[0] : "";
        var cleanName = suffix ? name.slice(0, -suffix.length) : name;

        for (var i = 0; i < prefixRules.length; i++) {
            var rule = prefixRules[i];
            if (rule.prefix && cleanName.toUpperCase().startsWith(rule.prefix.toUpperCase())) {
                return cleanName.substring(rule.prefix.length) + suffix;
            }
        }
        var match = cleanName.match(/^[A-Z0-9]+-/i);
        if (match) {
            return cleanName.substring(match[0].length) + suffix;
        }
        return cleanName + suffix;
    }

    function extractFinishName(mtxField, itemTag) {
        if (!mtxField || !itemTag) return null;
        var escapedTag = itemTag.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        var matchPattern = new RegExp('FINISH:\\s*' + escapedTag + '\\s+([A-Z0-9][A-Z0-9\\s]*)', 'i');
        var match = mtxField.match(matchPattern);
        if (!match) return null;
        var finishDesc = match[1].replace(/\b(DSGNR|WOOD|LINE|USTYLE|DSTYLE|DCODE|WCODE)\b.*$/i, '').trim();
        return finishDesc;
    }

    function findColorInTag(listMap, itemTag) {
        if (!itemTag) return null;
        var tagUpper = itemTag.toUpperCase();
        for (var key in listMap) {
            // Strip numeric prefixes like "106 - " to get raw color name
            var rawListName = key.replace(/^\d+\s*-\s*/, '').trim();
            var regex = new RegExp('\\b' + rawListName + '\\b', 'i');
            if (regex.test(tagUpper)) {
                return listMap[key];
            }
        }
        return null;
    }

    function getFinishSegment(mtxField) {
        if (!mtxField) return "";
        var match = mtxField.match(/FINISH:\s*([A-Z0-9][A-Z0-9\s]*)/i);
        if (!match) return "";
        return match[1].replace(/\b(DSGNR|WOOD|LINE|USTYLE|DSTYLE|DCODE|WCODE)\b.*$/i, '').trim();
    }

    function findColorInSegment(listMap, segment) {
        if (!segment) return null;
        var segmentUpper = segment.toUpperCase();
        for (var key in listMap) {
            var rawListName = key.replace(/^\d+\s*-\s*/, '').trim();
            var regex = new RegExp('\\b' + rawListName + '\\b', 'i');
            if (regex.test(segmentUpper)) {
                return listMap[key];
            }
        }
        return null;
    }

    function applyColorOptions(rec, prefix, matchedMtx, itemTag, stainsMap, colorsMap, mtxField) {
        if (!prefix || !itemTag) return;
        if (ALL_YELLOW_PREFIXES.indexOf(prefix) === -1) return;

        var isStain = STAIN_PREFIXES.indexOf(prefix) !== -1;
        var resolvedId = null;

        // Try resolving from MTX finish segment first
        var finishSegment = getFinishSegment(mtxField);
        if (finishSegment) {
            resolvedId = findColorInSegment(isStain ? stainsMap : colorsMap, finishSegment);
        }

        // Fallback to original logic if not resolved
        if (!resolvedId) {
            var finishName = "";
            if (matchedMtx) {
                finishName = matchedMtx.replace('FINISH:', '').replace(itemTag, '').trim();
            }
            if (!finishName) {
                finishName = extractFinishName(mtxField, itemTag);
            }
            resolvedId = isStain ? 
                (findListId(stainsMap, finishName) || findColorInTag(stainsMap, itemTag)) :
                (findListId(colorsMap, finishName) || findColorInTag(colorsMap, itemTag));
        }

        if (isStain) {
            if (resolvedId) {
                try {
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: CONFIG.FIELDS.PLUS_STAIN_COLOR, value: resolvedId });
                    log.audit('Dynamically Set Stain Option', 'Resolved color ID: ' + resolvedId);
                } catch (e) {
                    log.error('Error setting stain field', e.message);
                }
            } else {
                log.error('Stain ID not resolved', 'Tag: ' + itemTag);
            }
        } else {
            if (resolvedId) {
                try {
                    rec.setCurrentSublistValue({ sublistId: 'item', fieldId: CONFIG.FIELDS.PLUS_POINT_COLOR, value: resolvedId });
                    log.audit('Dynamically Set Paint Option', 'Resolved color ID: ' + resolvedId);
                } catch (e) {
                    log.error('Error setting paint field', e.message);
                }
            } else {
                log.error('Color ID not resolved', 'Tag: ' + itemTag);
            }
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
