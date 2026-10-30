/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope Public
 * @originalauthor Mayer Lench
 * @client CNC Cabinetry
 */

define(["N/record", "N/log", "N/search", "N/query", "../mqb-modified/fd_mqb_util_modified_again"], function (record, log, search, query, nk_mqb_util) {

    var beforeSubmit = function (context) {
        try {

            var { newRecord } = context;
            var rec = newRecord;
            if (rec.type !== record.Type.SALES_ORDER && rec.type !== record.Type.ESTIMATE)
                return;

            var isSkipMqbCalculation = rec.getValue('custbody_mqb_skip_calculation');
            if (isSkipMqbCalculation) {
                log.debug('SKIPPING MQB CALCULATION!', 'custbody_mqb_skip_calculation == ' + isSkipMqbCalculation);
                return
            }
            if (context.type !== context.UserEventType.EDIT && context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.COPY && context.type !== context.UserEventType.APPROVE)
                return;

            var tranid = rec.getValue('tranid');
            var subsidiaryId = rec.getValue('subsidiary');
            var locationId = rec.getValue('location');

            var xferdate = rec.getValue('custbody_yy_so_xferdate');
            var custbody_yy_qu_transfercheck = rec.getValue('custbody_yy_qu_transfercheck');

            if (xferdate || custbody_yy_qu_transfercheck) {
                locationId = '7';
            }

            var entity = rec.getValue('entity');
            var isLargeOrder = rec.getValue('custbody27');
            var custbody_yy_so_replacement = rec.getValue('custbody_yy_so_replacement');

            var custbody_yy_nfp = rec.getValue('custbody_yy_nfp');
            var custbody_yy_so_manualnfp = rec.getValue('custbody_yy_so_manualnfp');
            var trandate = rec.getValue('trandate');
            var entityText;
            var defaultWarehouse;
            var orderstatus = rec.getValue('orderstatus');
            var unapproved = context.type == 'approve' || orderstatus == 'A';
            var comeAgain;

            try {
                var results = search.lookupFields({ type: record.Type.CUSTOMER, id: entity, columns: ['entityid', 'custentitymb_warehouse_location'] });
                entityText = results && results.entityid;
                defaultWarehouse = results && results.custentitymb_warehouse_location && results.custentitymb_warehouse_location[0] && results.custentitymb_warehouse_location[0].value;
                log.debug('defaultWarehouse', defaultWarehouse);
            } catch (e) { log.error('@search.lookupFields', e.message); }

            if (custbody_yy_so_manualnfp) {
                custbody_yy_nfp = rec.getValue({ fieldId: 'custbody_yy_nfp' })
            }

            else if (custbody_yy_so_replacement) {
                try {
                    custbody_yy_nfp = search.lookupFields({ type: search.Type.TRANSACTION, id: custbody_yy_so_replacement, columns: 'custbody_yy_nfp' });
                    custbody_yy_nfp = custbody_yy_nfp && custbody_yy_nfp.custbody_yy_nfp;
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: custbody_yy_nfp });
                } catch (e) { log.error('@search.lookupFields', e.message); }
            }

            else if (entityText.substring(0, 3) == 'LPS') {
                if ([
                    'LPS : LPS-MIN',
                    'LPS : LPS-ATL',
                    'LPS : LPS-CHAR',
                    'LPS : LPS-DAL',
                    'LPS : LPS-DEN',
                    'LPS : LPS-HOU',
                    'LPS : LPS-LA',
                    'LPS : LPS-LAC',
                    'LPS : LPS-LAS',
                    'LPS : LPS-MIA',
                    'LPS : LPS-NORF',
                    'LPS : LPS-ORL',
                    'LPS : LPS-PHO',
                    'LPS : LPS-RAL',
                    'LPS : LPS-RICH',
                    'LPS : LPS-SAC',
                    'LPS : LPS-SAN',
                    'LPS : LPS-SAND',
                    'LPS : LPS-SANFRAN',
                    'LPS : LPS-SANTA',
                    'LPS : LPS-SEA',
                    'LPS : LPS-TAMPA',
                    'LPS : LPS-NASH'
                ].includes(entityText)) {
                    custbody_yy_nfp = true;
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: true })
                }
                else {
                    custbody_yy_nfp = trandate.getTime() >= new Date('12/8/2025').getTime();
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: custbody_yy_nfp });
                }
            }

            else if (trandate.getTime() >= new Date('6/15/2025').getTime()) {
                custbody_yy_nfp = true;
                rec.setValue({ fieldId: 'custbody_yy_nfp', value: custbody_yy_nfp });
            }

            else if (entityText.substring(0, 4) == 'PARR' && trandate.getTime() >= new Date('1/9/2024').getTime()) {
                custbody_yy_nfp = true;
                rec.setValue({ fieldId: 'custbody_yy_nfp', value: true })
            }

            else if (['KBCREATION', 'OK'].includes(entityText) && trandate.getTime() >= new Date('1/1/2025').getTime()) {
                custbody_yy_nfp = true;
                rec.setValue({ fieldId: 'custbody_yy_nfp', value: true })
            }

            else if (locationId != '7' && trandate.getTime() >= new Date('4/12/2024').getTime()) {
                custbody_yy_nfp = true;
                rec.setValue({ fieldId: 'custbody_yy_nfp', value: custbody_yy_nfp });
            }

            else if (locationId == '7') {
                if (defaultWarehouse != '7' && trandate.getTime() >= new Date('2/9/2025').getTime()) {
                    // This should not run the opposite way, meaning that if a customer with NJ as the default warehouse should still get NFP for orders with a different location
                    custbody_yy_nfp = true;
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: true })
                }
                else {
                    if (!['PANE', 'BONDP', 'MANS', 'NHF', 'NY', 'KURT', 'BCAB'].includes(entityText) && !['NHF :'].includes((entityText || '').slice(0, 5)) && !['BCAB :'].includes((entityText || '').slice(0, 6))) {
                        comeAgain = true;
                    }
                    custbody_yy_nfp = false;
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: false });
                    // We still want to pass FP to the MQB function so we get both FP and NFP BOMs
                }
            }

            var bestBoms = [];
            var allBoms = [];
            var itemsLines = getItemLines(rec).filter(item => ['Assembly', 'InvtPart'].includes(item.type));
            var buildables = nk_mqb_util.maxQtyBuildable({ itemsLines, subsidiaryId, locationId, isLargeOrder, entityText, custbody_yy_nfp, detailed: true });
            log.debug(`${tranid == 'To Be Generated' ? 'New Order ' : tranid + ' '}>>> ALL ORDER ITEM'S BOM INFO {item id: [bom info]}`, buildables);
            itemsLines.reduce(function (itemBomLookupObj, _a) {

                var { itemid, type: itemtype, quantity, line, name, isMilanoOrBroadway } = _a;
                var allItemBoms = itemBomLookupObj[itemid] && itemBomLookupObj[itemid].boms || itemBomLookupObj[itemid] || [];
                _a.name ||= itemBomLookupObj[itemid] && itemBomLookupObj[itemid].name;

                if (!_a.name) { log.error(rec.getValue('tranid'), 'Item name undefined'); }
                if (isMilanoOrBroadway && ['OCM', 'SCM', 'SHM', 'ICM'].some(section => (name || '').includes(section))) {
                    _a.override = false;
                }
                allBoms = allBoms.concat(allItemBoms);

                var bestBom = nk_mqb_util.getBestBom({ quantity, boms: allItemBoms });
                bestBoms.push(bestBom);
                var bestBomId = bestBom && bestBom.id || '';
                var bestBomBuildableQty = bestBom && bestBom.mqb || 0; // bbbq
                var isBuildable = Math.floor(bestBomBuildableQty - quantity) >= 0;
                // Inventory items don't have BOMs and their availability depends on the item itself
                if (itemtype == 'InvtPart') {
                    log.debug('itemBomLookupObj', JSON.stringify(itemBomLookupObj));
                    log.debug('Inventory Item Availability', itemBomLookupObj[itemid].available);
                    isBuildable = itemBomLookupObj[itemid].available > quantity;
                    itemBomLookupObj[itemid].available -= quantity;
                }

                // As per Yitz Younger and Ellie Drew 7/19/2023
                // Most items that are part of the CONCORD collections are not considered backordered (in NJ) as far as customer service is concerned.
                // In the event that manufacturing sees no way    
                // of building the items they will notify cutomer service manually 

                var override = _a.override;

                // log.debug(bestBomId, allItemBoms);
                var bestBomIndex = allItemBoms.indexOf(allItemBoms.find(bom => bom.id == bestBomId));
                rec.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_mb_buildable',
                    value: isBuildable,
                    line: line
                });
                rec.setSublistValue({ // Not needed for client script as field is hidden
                    sublistId: 'item',
                    fieldId: 'custcol_nk_has_buildable_bom',
                    value: isBuildable,
                    line: line
                });
                rec.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_fd_mqb_bom_id',
                    value: bestBomId,
                    line: line
                });

                // Update buildable quantity in case there are still more of that item on the sales order
                if (isBuildable && itemtype !== 'InvtPart') {
                    (itemBomLookupObj[itemid] && itemBomLookupObj[itemid].boms || itemBomLookupObj[itemid])[bestBomIndex].mqb -= quantity;
                }
                return itemBomLookupObj;
            }, buildables);
            log.debug('bestBoms', bestBoms);
            // Loop over the lines one more time and mark them buildable if the work order is buildable
            var woids = [];
            for (var line = 0; line < newRecord.getLineCount('item'); line++) {
                var custcol_mb_buildable = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_buildable', line })
                var woid = (newRecord.getSublistValue({ sublistId: 'item', fieldId: 'woid', line }));
                if (woid && !custcol_mb_buildable) { woids.push(woid); }
            }
            try {
                if (woids.length) {
                    var queryStartTime = Date.now();
                    var workOrderBuildableLookup = query.runSuiteQL({
                        query: `
                            SELECT 
                                id as woid,
                                custbody_mb_wo_is_buildable as buildable
                            FROM
                                transaction
                            WHERE
                                transaction.id IN ('${woids.join("', '")}')
                        `
                    }).asMappedResults().reduce((lookup, { woid, buildable }) => { lookup[woid] = buildable; return lookup }, {});
                    log.debug('Query Duration', Date.now() - queryStartTime);
                    log.debug('[workOrderBuildableLookup]', workOrderBuildableLookup);
                    for (var line = 0; line < newRecord.getLineCount('item'); line++) {
                        var woid = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'woid', line });
                        if (workOrderBuildableLookup[woid] == 'T') {
                            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_buildable', line, value: !('') })
                        }
                    }
                }
            } catch (e) { log.error('@workOrderBuildableLookup'); }
            if (unapproved && comeAgain && allBoms.some(bom => bom.fpBom)) {
                if (bestBoms.every(bom => bom.fpBom == false)) {
                    log.debug('[FP order with only NFP BOMs]', tranid);
                    custbody_yy_nfp = true;
                    rec.setValue({ fieldId: 'custbody_yy_nfp', value: true });
                }
                else {
                    log.debug(`[FP order with FP BOMs (${tranid})]`, bestBoms.filter(bom => bom.fpBom));
                }
            }
            if (unapproved && custbody_yy_nfp && !custbody_yy_so_replacement) {
                var hasAnyBuildableFpBom;
                try {
                    var allFpBoms = Object.values(buildables).reduce((list, item) => list.concat(item.fpBoms), []);
                    hasAnyBuildableFpBom = allFpBoms.some(bom => !bom.linesBackordered);
                    if (
                        !['KBCREATION', 'OK', 'PANE', 'CAMP', 'BONDP', 'MANS', 'NHF', 'NY', 'KURT', 'LPS', 'BCAB', 'CAMPBELL', 'STINE-SULPHUR', 'SLAND', '2NDS', 'HHC-SINGLE'].includes(entityText)
                        && !['LPS :'].includes((entityText || '').slice(0, 5))
                        && !['NHF :'].includes((entityText || '').slice(0, 5))
                        && !['BCAB :'].includes((entityText || '').slice(0, 6))
                        && !['SLAND :'].includes((entityText || '').slice(0, 7))
                        && !['HHC-SINGLE :'].includes((entityText || '').slice(0, 12))
                        && !['STINE-SULPHUR :'].includes((entityText || '').slice(0, 15))
                    ) {
                        if (hasAnyBuildableFpBom) {
                            var vanities = search.create({
                                type: search.Type.ITEM,
                                filters: [
                                    ['internalid', 'anyof', itemsLines.map(({ itemid }) => itemid)], 'AND',
                                    ['custitem_mb_item_item_type', 'anyof', '7']
                                ],
                                columns: ['custitem_mb_item_item_type']
                            }).run().getRange({ start: 0, end: 1000 }).map(result => result.id);
                            log.debug('vanities', vanities);
                            if (vanities.length && vanities.every(vanity => buildables[vanity] && buildables[vanity].fpBoms && buildables[vanity].fpBoms.some(bom => !bom.linesBackordered && bom.mqb > itemsLines.filter(line => line.item == vanity).reduce((sum, line) => sum += line.quantity || 0, 0)))) {
                                log.debug(`[FP Vanity Candidate]`, tranid);
                                rec.setValue({ fieldId: 'custbody_nk_fp_vanities', value: true });
                            }
                        }
                    }
                } catch (e) { log.error('@set hasAnyBuildableFpBom', e.message); }
            }
        } catch (e) { log.error(`${tranid} @beforeSubmit`, e.message) }
    };

    var getItemLines = function (rec) {

        var lineCount = rec.getLineCount('item');
        var location = rec.getValue({ fieldId: 'location' });
        var xferdate = rec.getValue('custbody_yy_so_xferdate');
        var custbody_yy_qu_transfercheck = rec.getValue('custbody_yy_qu_transfercheck');
        var alwaysBuildableItems = [82755]

        return Array.from({ length: lineCount }, (v, i) => i).map(function (line) {

            var item = rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line });
            var override = alwaysBuildableItems.includes(Number(item));
            var isMilanoOrBroadway;
            if (!override && (location == 7 || xferdate || custbody_yy_qu_transfercheck)) {
                try {
                    var collection = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: line });
                    var isConOrCls = collection == 1 || collection == 2;

                    if (isConOrCls) {
                        var fields = search.lookupFields({ type: search.Type.ITEM, id: item, columns: ['custitem_mb_item_item_type', 'custitem_mb_item_style', 'custitem_er_collection_group'] });
                        var custitem_mb_item_item_type = fields.custitem_mb_item_item_type[0] && fields.custitem_mb_item_item_type[0].value;
                        var custitem_mb_item_style = fields.custitem_mb_item_style[0] && fields.custitem_mb_item_style[0].value;
                        var custitem_er_collection_group = fields.custitem_er_collection_group[0] && fields.custitem_er_collection_group[0].value;
                        isMilanoOrBroadway = [1, 2, 3, 4, 7, 8].includes(parseInt(custitem_er_collection_group));
                        var isHood = '14' == custitem_mb_item_item_type;
                        var isSampleDoor = '17' == custitem_mb_item_item_type;
                        var isAccessory = '8' == custitem_mb_item_item_type;
                        var isParkAve = '4' == custitem_mb_item_style || '29' == custitem_mb_item_style;;
                        if (!isHood && !isSampleDoor && !isAccessory && !isParkAve) {
                            override = true;
                        }
                    }
                } catch (e) { log.error('@search.lookupFields', e.message); }
            }

            return {
                name: rec.getSublistValue({ sublistId: 'item', fieldId: 'item_display', line: line }),
                itemid: rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line }),
                quantity: rec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: line }),
                type: rec.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: line }),
                collection: rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: line }),
                custcol_fd_tls_item_group: rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_fd_tls_item_group', line: line }),
                isMilanoOrBroadway,
                override,
                line
            };
        });
    };

    return { beforeSubmit }
});