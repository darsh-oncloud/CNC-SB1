/**
 * Copyright         2024 RSM US LLP
 * Description       Sales Order user event script.
 * Collaborative Link:  https://rsmnet.sharepoint.com/:w:/r/sites/IWS_CS_eCommDM/ClientDocumentation/CNC%20Cabinetry/CNC%20-%20SCA%20Customization%20Specifications.docx?d=w97523f53fa9c4546833e06eb7888311b&csf=1&web=1&e=WsBYCg
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
        define(["require", "exports", "./NFT-SS2-7.2.0/EC_Logger", "./NFT-SS2-7.2.0/lodash", "N/runtime", "N/record", "N/search", "N/query", "./RecordTypes/SalesOrder", "./RSM_Lib_Shared", "./RecordTypes/Customer"], factory);
    }
})(function (require, exports) {
    "use strict";
    const LogManager = require("./NFT-SS2-7.2.0/EC_Logger");
    const _ = require("./NFT-SS2-7.2.0/lodash");
    const runtime = require("N/runtime");
    const record = require("N/record");
    const search = require("N/search");
    const query = require("N/query");
    const SalesOrder_1 = require("./RecordTypes/SalesOrder");
    const RSM_Lib_Shared_1 = require("./RSM_Lib_Shared");
    const Customer_1 = require("./RecordTypes/Customer");
    const log = LogManager.DefaultLogger;
    var X;
    (function (X) {
        /**
         * before submit entry point
         */
        function beforeSubmit(ctx) {
            var _a;
            const newRecord = new SalesOrder_1.SalesOrder(ctx.newRecord);
            if (ctx.type === ctx.UserEventType.CREATE ||
                ctx.type === ctx.UserEventType.EDIT ||
                ctx.type === ctx.UserEventType.OTHER) {
                // Fix non ASCII characters in PO field. They break Braintree
                newRecord.otherrefnum = (0, RSM_Lib_Shared_1.cleanPurchaseOrderNumber)(newRecord.otherrefnum);
            }
            log.debug('runtime.executionContext', runtime.executionContext);
            if ((runtime.executionContext === runtime.ContextType.WEBSTORE &&
                ctx.type === ctx.UserEventType.CREATE) ||
                (runtime.executionContext === runtime.ContextType.SUITELET &&
                    ctx.type === ctx.UserEventType.CREATE &&
                    newRecord.custbody_rsm_created_from_q_on_web)) {
                log.debug('items', newRecord.item);
                // check if this SO is created from a quote
                // This will keep the quotes item order which is already sorted
                // also Removing lines on a Quote => SO transform will cause issues
                const createdFromQuoteOnWebSite = newRecord.custbody_rsm_created_from_q_on_web;
                log.debug('createdFromQuoteOnWebSite', createdFromQuoteOnWebSite);
                if (!createdFromQuoteOnWebSite) {
                    // resorting items to make them the same order on the backend SO as the frontend view
                    X.removeAndReAddLinesToSort(newRecord);
                }
                // Getting the shipping details from the first line with shipping details
                const firstLineWithShippingDetailsJSON = X.getShippingDetailsFromLine(newRecord);
                log.debug('firstLineWithShippingDetailsJSON', firstLineWithShippingDetailsJSON);
                log.debug('firstLineWithShippingDetailsJSON.otherCharges', firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.extraCharges);
                // Add a new line to the Sales Order with the tariff item and amount from the front end json
                if (!createdFromQuoteOnWebSite) {
                    if ((firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.tariffFeeTotal) !== undefined) {
                        const tariffFeeId = runtime.getCurrentScript().getParameter({ name: 'custscript_rsm_so_ue_tariff_fee_item_id' });
                        const existingTariffLine = _.find(newRecord.item, line => line.item === tariffFeeId);
                        log.debug('existingTariffLine', existingTariffLine);
                        if (existingTariffLine != undefined) {
                            existingTariffLine.amount = firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.tariffFeeTotal;
                        }
                        else {
                            // CNC commented out this code because orders were still getting the fee after the config turned off
                            // Note that the config will not turn this feature on until this code is uncommented
                            // CNC said that leaving this as is will be okay for the future
                            // I beleive the problem that made the config not work was existing carts did not have the tariff fee cleared
                            // the code that needed to be fixed is
                            // RSM.CustomOrder.Model > this.setOrderField('tariffFeeTotal', tariffFeeTotal)
                            // The tariff fee only gets set if the feature is enabled so it never clears existing fees on existing carts
                            // once the feature is turned off
                            // NOTE: Also see Quote UE
                            // const tariffFeeLine = newRecord.item.addLine()
                            // tariffFeeLine.item = Number(tariffFeeId)
                            // tariffFeeLine.amount = Number(firstLineWithShippingDetailsJSON.tariffFeeTotal)
                            // tariffFeeLine.taxcode = 91457
                        }
                    }
                }
                if (firstLineWithShippingDetailsJSON === undefined) {
                    throw 'The order is missing shipping details. Please contact customer support.';
                }
                let needToSubtractOtherCharges = false;
                if ((firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.extraCharges) !== undefined) {
                    newRecord.custbody_yy_so_handlingcost = firstLineWithShippingDetailsJSON.extraCharges;
                    newRecord.handlingcost = firstLineWithShippingDetailsJSON.extraCharges;
                    needToSubtractOtherCharges = true;
                }
                // If there are shipping details then we set the shipping on the order
                if ((firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.shippingRate) !== undefined) {
                    if (needToSubtractOtherCharges) {
                        newRecord.shippingcost = Number(firstLineWithShippingDetailsJSON.shippingRate) - Number(firstLineWithShippingDetailsJSON.extraCharges);
                    }
                    else {
                        newRecord.shippingcost = firstLineWithShippingDetailsJSON.shippingRate;
                    }
                }
                // Set the order status under certain conditions
                // Removing this for now because it is not needed
                // X.setOrderStatus(newRecord)
                // Setting the location
                newRecord.location = Number(firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.warehouse);
                // Setting the Ship Preference
                if ((firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.shippingPreference) === 'shipAvailable') {
                    newRecord.custbody_yy_so_shippref = 2;
                }
                else if ((firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.shippingPreference) === 'shipComplete') {
                    newRecord.custbody_yy_so_shippref = 1;
                }
                // Setting the Requested Ship Date
                if ((firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.shippingPreference) === 'shipComplete' &&
                    (firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.requestedBackorderDate)) {
                    newRecord.shipdate = new Date(firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.requestedBackorderDate);
                }
                else {
                    newRecord.shipdate = new Date(firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.requestedShipDate);
                }
                // Setting the Backorder Ship Date
                newRecord.custbody_yy_so_bodate =
                    (firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.requestedBackorderDate)
                        ? new Date(firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.requestedBackorderDate)
                        : null;
                log.debug('firstLineWithShippingDetailsJSON?.selectedShipping.methodName', (_a = firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.selectedShipping) === null || _a === void 0 ? void 0 : _a.methodName);
                newRecord.custbody_rsm_order_tag = (firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.orderTag) || '';
                // Look up and set the GNI Project ID from the associated wish list
                const gniProjectId = (0, RSM_Lib_Shared_1.getGniProjectIdFromWishList)(firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.wishlistId);
                if (gniProjectId) {
                    newRecord.custbody_rsm_gni_project_id = gniProjectId;
                }
            }
            if (ctx.type === ctx.UserEventType.CREATE && runtime.executionContext === runtime.ContextType.WEBSTORE) {
                // Update countertop lines with correct amount and UOM
                (0, RSM_Lib_Shared_1.updateCountertopLines)(newRecord);
            }
        }
        X.beforeSubmit = beforeSubmit;
        /**
         * after submit entrypoint
         */
        function afterSubmit(ctx) {
            var _a;
            const newRecord = new SalesOrder_1.SalesOrder(ctx.newRecord);
            if (ctx.type === ctx.UserEventType.CREATE) {
                // build braintree payment link and save to SO
                let baseURL = '';
                let braintreePaymentLink = '';
                const scriptObj = runtime.getCurrentScript();
                baseURL = String(scriptObj.getParameter({ name: 'custscript_rsm_so_ue_braint_url' }));
                braintreePaymentLink = baseURL + newRecord.id;
                record.submitFields({
                    type: record.Type.SALES_ORDER,
                    id: newRecord.id,
                    values: {
                        custbody_rsm_external_payment_link: braintreePaymentLink
                    }
                });
            }
            if ((runtime.executionContext === runtime.ContextType.WEBSTORE &&
                ctx.type === ctx.UserEventType.CREATE) ||
                (runtime.executionContext === runtime.ContextType.SUITELET &&
                    ctx.type === ctx.UserEventType.CREATE &&
                    newRecord.custbody_rsm_created_from_q_on_web)) {
                // lookup tranid since it isn't on context
                const fieldLookUp = search.lookupFields({
                    type: search.Type.SALES_ORDER,
                    id: newRecord.id,
                    columns: ['tranid']
                });
                const tranid = ((_a = fieldLookUp[0]) === null || _a === void 0 ? void 0 : _a.tranid) || fieldLookUp.tranid || '';
                const firstLineWithShippingDetailsJSON = X.getShippingDetailsFromLine(newRecord);
                log.debug('firstLineWithShippingDetailsJSON', firstLineWithShippingDetailsJSON);
                if (firstLineWithShippingDetailsJSON === undefined) {
                    throw 'The order is missing shipping details. Please contact customer support.';
                }
                // Create pickup order records for pickup use case
                if (firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.selectedShipping.methodName.includes('Pickup')) {
                    if ((firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.shippingPreference) === 'shipComplete' &&
                        (firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.requestedBackorderDate)) {
                        // all items being picked up at completion
                        X.createPickUpOrder(newRecord.id, tranid, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.pickupDuration, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.requestedBackorderDate, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.completePickupTime, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.warehouse);
                    }
                    else if ((firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.shippingPreference) === 'shipAvailable' &&
                        (firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.requestedBackorderDate)) {
                        // some items being picked up when available
                        X.createPickUpOrder(newRecord.id, tranid, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.pickupDuration, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.requestedShipDate, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.availablePickupTime, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.warehouse);
                        // rest of items being picked up when completely ready
                        X.createPickUpOrder(newRecord.id, tranid, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.pickupDuration, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.requestedBackorderDate, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.completePickupTime, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.warehouse);
                    }
                    else {
                        // all items being picked up at available
                        X.createPickUpOrder(newRecord.id, tranid, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.pickupDuration, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.requestedShipDate, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.availablePickupTime, firstLineWithShippingDetailsJSON === null || firstLineWithShippingDetailsJSON === void 0 ? void 0 : firstLineWithShippingDetailsJSON.warehouse);
                    }
                }
                X.updateWishLists(newRecord);
                X.resetDefaultAddress(newRecord);
            }
        }
        X.afterSubmit = afterSubmit;
        /**
         * Removes and readds all items so the items are in the same order as the website view
         * also has to readd promos so they apply
         * @param newRec
         */
        function removeAndReAddLinesToSort(newRec) {
            // Note: not using NFT so that we don't need to add
            // every new custcol_ field to the sale order item line type.
            // native props
            const linePropToCopy = [];
            // line fields list
            const sublistFields = newRec.nsrecord.getSublistFields({
                sublistId: 'item'
            });
            _.each(sublistFields, fieldId => {
                linePropToCopy.push(fieldId);
            });
            const numItems = newRec.nsrecord.getLineCount({
                sublistId: 'item'
            });
            // store old lines
            const oldLines = [];
            _.each(newRec.item, (line, lineIndex) => {
                const oldLine = {};
                _.each(linePropToCopy, propId => {
                    oldLine[propId] = newRec.nsrecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: propId,
                        line: lineIndex
                    });
                });
                oldLines.push(oldLine);
            });
            addIsSideSplashProp(oldLines);
            // remove all SO lines - back to front
            for (let i = numItems - 1; i >= 0; i--) {
                newRec.nsrecord.removeLine({
                    sublistId: 'item',
                    line: i,
                    ignoreRecalc: true
                });
            }
            // parse JSON - and copy data out of json and into line fields
            _.each(oldLines, oldLine => {
                oldLine.parsedJSON = parseLineJSON(oldLine);
                copyLineJSONValueIntoCol(oldLine);
            });
            // sort
            const sortedLines = sortLines(oldLines);
            // re-add lines
            let pctModsTable = {};
            let writeLineCount = 0;
            sortedLines.forEach((line) => {
                if (line.itemtype != 'Discount') {
                    // we need to combine percent charge items into one line
                    let parsedJson = line.parsedJSON;
                    let lineIsPctCharge = !!parsedJson.pctMult;
                    if (lineIsPctCharge) {
                        // track percent charge data - but don't add them till the end
                        let pct = Number(parsedJson.pctMult);
                        let parentLineAmount = findParentLineAmount(line, newRec.nsrecord);
                        let amountToAdd = (parentLineAmount * pct);
                        if (pctModsTable[line.item]) {
                            pctModsTable[line.item].total += amountToAdd;
                        }
                        else {
                            pctModsTable[line.item] = { total: amountToAdd };
                        }
                    }
                    else {
                        // add lines to sales order normally
                        _.each(linePropToCopy, propId => {
                            newRec.nsrecord.setSublistValue({
                                sublistId: 'item',
                                fieldId: propId,
                                line: writeLineCount,
                                value: line[propId]
                            });
                        });
                        writeLineCount += 1;
                    }
                }
            });
            // add pecent charge lines to the end
            const lineCount = newRec.nsrecord.getLineCount({ sublistId: 'item' });
            let pctModsIndex = 0;
            _.each(pctModsTable, (pctValue, pctKey) => {
                newRec.nsrecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: pctModsIndex + lineCount,
                    value: pctKey
                });
                newRec.nsrecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: pctModsIndex + lineCount,
                    value: 1
                });
                newRec.nsrecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: pctModsIndex + lineCount,
                    value: pctValue.total
                });
                newRec.nsrecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'amount',
                    line: pctModsIndex + lineCount,
                    value: pctValue.total
                });
                pctModsIndex += 1;
            });
            // do the same thing w/ promotion codes
            // care autoApplyPromosToAdd come from SCA and need properties added there
            const promoPropsToCopy = [
                'promocode'
            ];
            const numPromotions = newRec.nsrecord.getLineCount({
                sublistId: 'promotions'
            });
            // store old promos
            let oldPromos = [];
            for (var p = 0; p < numPromotions; p++) {
                const oldPromo = {};
                _.each(promoPropsToCopy, propId => {
                    oldPromo[propId] = newRec.nsrecord.getSublistValue({
                        sublistId: 'promotions',
                        fieldId: propId,
                        line: p
                    });
                });
                oldPromos.push(oldPromo);
            }
            // remove all SO promos - back to front
            for (let i = numPromotions - 1; i >= 0; i--) {
                newRec.nsrecord.removeLine({
                    sublistId: 'promotions',
                    line: i
                    // ignoreRecalc: true
                });
            }
            // get list of auto apply promos to add
            let autoApplyPromosToAdd = [];
            const custbody_rsm_auto_app_promo_web = newRec.nsrecord.getValue({ fieldId: 'custbody_rsm_auto_app_promo_web' });
            if (custbody_rsm_auto_app_promo_web) {
                try {
                    autoApplyPromosToAdd = JSON.parse(custbody_rsm_auto_app_promo_web);
                }
                catch (error) {
                    log.error('error parsing custbody_rsm_auto_app_promo_web');
                }
            }
            autoApplyPromosToAdd = _.filter(autoApplyPromosToAdd, autoPromo => {
                const foundInOld = _.find(oldPromos, oldPromo => {
                    return oldPromo.promocode == autoPromo.promocode;
                });
                return !foundInOld;
            });
            // combine promos
            oldPromos = oldPromos.concat(autoApplyPromosToAdd);
            // re-add promos
            _.each(oldPromos, (promo, promoIndex) => {
                _.each(promoPropsToCopy, propId => {
                    newRec.nsrecord.setSublistValue({
                        sublistId: 'promotions',
                        fieldId: propId,
                        line: Number(promoIndex),
                        value: promo[propId]
                    });
                });
            });
        }
        X.removeAndReAddLinesToSort = removeAndReAddLinesToSort;
        /**
         * Function that actually does the sorting
         * @param lines
         * @returns
         */
        function sortLines(lines) {
            // sort by three properties
            let sortedLines = _.sortBy(lines, l => { return l.parsedJSON.order; });
            sortedLines = _.sortBy(sortedLines, l => { return l.parsedJSON.groupNumber; });
            sortedLines = _.sortBy(sortedLines, l => { return !!l.parsedJSON.parentUid; });
            // remove mods and re-insert mod them after their parent
            const firstModIndex = _.findIndex(sortedLines, (l) => { return !!l.parsedJSON.parentUid; });
            if (firstModIndex >= 0) {
                const removedMods = sortedLines.splice(firstModIndex, Infinity);
                // sort mod lines so that side splashes get added last
                removedMods.sort((lineA, lineB) => {
                    const isA = lineA.isSideSplash;
                    const isB = lineB.isSideSplash;
                    if (isA && !isB) {
                        return 1;
                    }
                    else if (!isA && isB) {
                        return -1;
                    }
                    else {
                        return 0;
                    }
                });
                _.each(removedMods, rm => {
                    const parentIndex = _.findIndex(sortedLines, (l) => {
                        return l.parsedJSON.uid == rm.parsedJSON.parentUid;
                    });
                    if (parentIndex >= 0) {
                        sortedLines.splice(parentIndex + 1, 0, rm);
                    }
                });
            }
            return sortedLines;
        }
        /**
         * Is Sku a side splash sku
         * @param fullSku
         * @returns
         */
        function isSideSplashSku(fullSku) {
            if (!fullSku) {
                return false;
            }
            const cleanSku = fullSku.trim().toLowerCase();
            const lastThreeChars = cleanSku.substring(cleanSku.length - 3, cleanSku.length);
            return lastThreeChars == 'lss' || lastThreeChars == 'rss';
        }
        function addIsSideSplashProp(lines) {
            const itemIds = [];
            _.each(lines, line => {
                itemIds.push(line.item);
            });
            const searchResults = query
                .runSuiteQL({ query: `select id, itemid from item where id IN (${itemIds.join(',')})` })
                .asMappedResults();
            _.each(lines, line => {
                const foundResult = _.find(searchResults, result => {
                    return result.id == line.item;
                });
                const sku = foundResult ? foundResult.itemid : '';
                line.isSideSplash = isSideSplashSku(sku);
            });
        }
        /**
         * Helper function to copy values out of json and into line fields
         * @param lineObj
         */
        function copyLineJSONValueIntoCol(lineObj) {
            const propertyMapping = {
                tag: 'custcol_mb_so_tag'
            };
            _.each(propertyMapping, (mapValue, mapKey) => {
                lineObj[mapValue] = lineObj.parsedJSON[mapKey] == 'none' ? '' : lineObj.parsedJSON[mapKey];
            });
        }
        /**
         * Creates a RSM pickup order to hold the pickup information the user selected
         * @param soId
         * @param pickupDuration
         * @param pickupDate
         * @param pickupTime
         * @param pickupWarehouse
         */
        function createPickUpOrder(soId, soNumber, pickupDuration, pickupDate, pickupTime, pickupWarehouse) {
            log.debug('pickupDate', pickupDate);
            log.debug('pickupTime', pickupTime);
            log.debug('pickupWarehouse', pickupWarehouse);
            const pickupOrder = record.create({
                type: 'customrecord_rsm_pickup_order',
                isDynamic: true
            });
            pickupOrder.setValue({ fieldId: 'name', value: 'Pickup for ' + soNumber });
            pickupOrder.setValue({ fieldId: 'custrecord_rsm_pickup_sales_order', value: soId });
            pickupOrder.setValue({
                fieldId: 'custrecord_rsm_pickup_duration',
                value: pickupDuration
            });
            pickupOrder.setValue({
                fieldId: 'custrecord_rsm_pickup_date',
                value: pickupDate
            });
            pickupOrder.setValue({
                fieldId: 'custrecord_rsm_pickup_time',
                value: pickupTime
            });
            pickupOrder.setValue({
                fieldId: 'custrecord_rsm_pickup_location',
                value: pickupWarehouse
            });
            const pickupId = pickupOrder.save();
            log.debug('pickup saved', pickupId);
        }
        X.createPickUpOrder = createPickUpOrder;
        /**
         *  Gets the shipping details from the first line with a location
         *
         * @param {SalesOrder} newRec
         * @return {*} An object with the line JSON or undefined
         */
        function getShippingDetailsFromLine(newRec) {
            let firstLineWithShippingDetailsJSON;
            // Getting the line JSON from the fist line with a location
            _.find(newRec.item, line => {
                const webStoreLineJSON = parseLineJSON(line);
                if ((webStoreLineJSON === null || webStoreLineJSON === void 0 ? void 0 : webStoreLineJSON.zip) !== undefined && (webStoreLineJSON === null || webStoreLineJSON === void 0 ? void 0 : webStoreLineJSON.zip) !== null && (webStoreLineJSON === null || webStoreLineJSON === void 0 ? void 0 : webStoreLineJSON.zip) !== '') {
                    firstLineWithShippingDetailsJSON = webStoreLineJSON;
                    return true;
                }
            });
            return firstLineWithShippingDetailsJSON !== null && firstLineWithShippingDetailsJSON !== void 0 ? firstLineWithShippingDetailsJSON : undefined;
        }
        X.getShippingDetailsFromLine = getShippingDetailsFromLine;
        /**
         * Sets the Sales Order status to "Pending Approval" under certain conditions otherwise "Pending Fulfillment".
         *
         * @param newRec
         */
        function setOrderStatus(newRec) {
            var _a;
            // Summing the total quantity of cabinets. As of right now, cabinets are "Assembly" items.
            const totalQuantityOfAssemblyItems = _.sumBy(newRec.item, line => {
                return line.itemtype === 'Assembly' ? line.quantity : 0;
            });
            // Getting the warehouse from the first line item
            const warehouseText = (_a = parseLineJSON(newRec.item[0])) === null || _a === void 0 ? void 0 : _a.warehouseText;
            let orderStatus = 'B';
            if (warehouseText === 'New Jersey' && totalQuantityOfAssemblyItems > 100) {
                orderStatus = 'A';
            }
            else if (totalQuantityOfAssemblyItems > 50) {
                orderStatus = 'A';
            }
            // Avoiding type checking on the orderstatus because the type is set to number but this needs to be a string.
            newRec.nsrecord.setValue({ fieldId: 'orderstatus', value: orderStatus });
        }
        X.setOrderStatus = setOrderStatus;
        /**
         * Updates the wish lists associated with a new sales order record.
         * This function retrieves the wish lists linked to the sales order and updates their status.
         *
         * @param {SalesOrder} newRec - The new sales order record.
         * @returns {void}
         */
        function updateWishLists(newRec) {
            // Retrieve the wish lists associated with the new sales order
            const wishLists = X.getWishLists(newRec);
            if (!getWishLists.length)
                return;
            // Iterate over each wish list and update its status to 'Submitted'
            _.each(wishLists, function (wishList) {
                if (wishList !== undefined && wishList !== null) {
                    record.submitFields({
                        id: wishList,
                        type: 'customrecord_ns_pl_productlist',
                        values: { custrecord_rsm_pl_pl_status: '2' },
                        options: {
                            enableSourcing: false,
                            ignoreMandatoryFields: true
                        }
                    });
                }
            });
        }
        X.updateWishLists = updateWishLists;
        function resetDefaultAddress(newRec) {
            const customer = new Customer_1.Customer(newRec.entity);
            let saveCustomer = false;
            if (setDefaultAddressHelper('bill', newRec, customer)) {
                saveCustomer = true;
            }
            if (setDefaultAddressHelper('ship', newRec, customer)) {
                saveCustomer = true;
            }
            if (setDefaultPhoneNumber(newRec, customer)) {
                saveCustomer = true;
            }
            if (saveCustomer) {
                customer.save();
            }
        }
        X.resetDefaultAddress = resetDefaultAddress;
        function setDefaultAddressHelper(type, newRec, customer) {
            var _a, _b;
            let updateAddress = false;
            // Set the back up id depending on the type
            const backupId = type === 'bill' ? newRec.custbody_rsm_def_bill_addr : newRec.custbody_rsm_def_ship_addr;
            if (_.isEmpty(backupId))
                return false;
            // Get the current default address id depending on the type
            const currentDefaultId = type === 'bill'
                ? (_a = _.find(customer.addressbook, (address) => address.defaultbilling)) === null || _a === void 0 ? void 0 : _a.id
                : (_b = _.find(customer.addressbook, (address) => address.defaultshipping)) === null || _b === void 0 ? void 0 : _b.id;
            // If the backup id is different from the current default address id, set the backup address as the default address
            if (!_.isNil(currentDefaultId) && currentDefaultId !== Number(backupId)) {
                _.forEach(customer.addressbook, (address) => {
                    if (address.id === Number(backupId)) {
                        if (!address.defaultbilling && type === 'bill') {
                            address.defaultbilling = true;
                            updateAddress = true;
                        }
                        else if (!address.defaultshipping && type === 'ship') {
                            address.defaultshipping = true;
                            updateAddress = true;
                        }
                    }
                });
            }
            return updateAddress;
        }
        X.setDefaultAddressHelper = setDefaultAddressHelper;
        function setDefaultPhoneNumber(newRec, customer) {
            let updateAddress = false;
            // Update the phone number on the customer if it different from the backup phone number
            // Natively is derived from the Default Billing Address but getting overwritten on order submission
            if (!_.isEmpty(newRec.custbody_rsm_def_phone) && newRec.custbody_rsm_def_phone != customer.phone) {
                customer.phone = newRec.custbody_rsm_def_phone;
                updateAddress = true;
            }
            return updateAddress;
        }
        X.setDefaultPhoneNumber = setDefaultPhoneNumber;
        /**
         * Retrieves the unique wish lists associated with a new sales order record.
         * This function extracts the wish list IDs from the sales order items.
         *
         * @param {SalesOrder} newRec - The new sales order record.
         * @returns {Array<any>} - An array of unique wish list IDs.
         */
        function getWishLists(newRec) {
            return _.chain(newRec.item)
                .map(function (line) {
                // Parse the JSON data from the custom column
                const webStoreLineJSON = parseLineJSON(line);
                return webStoreLineJSON === null || webStoreLineJSON === void 0 ? void 0 : webStoreLineJSON.wishlistId;
            })
                .uniq()
                .compact()
                .value();
        }
        X.getWishLists = getWishLists;
        /**
         * Parses the line JSON from the given line
         *
         * @param line
         * @private
         */
        function parseLineJSON(line) {
            try {
                return _.isEmpty(line.custcol_rsm_line_json)
                    ? {}
                    : JSON.parse(line.custcol_rsm_line_json);
            }
            catch (e) {
                log.error('Error parsing JSON in getParsedLineJSON', e);
            }
        }
        /**
       * Finds the parent line amount from the quote record of a charge line
       * @param chargeLine - charge line from the frontend
       * @param salesOrderRecord - sales order netsuite record
       * @returns amout as a number
       */
        function findParentLineAmount(chargeLine, salesOrderRecord) {
            let chargeLineJson = chargeLine.parsedJSON;
            let parentUid = chargeLineJson.parentUid;
            const lineCount = salesOrderRecord.getLineCount({ sublistId: 'item' });
            for (let i = lineCount - 1; i >= 0; i--) {
                let lineUid = salesOrderRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_rsm_line_uid',
                    line: i
                });
                if (lineUid == parentUid) {
                    let lineRate = salesOrderRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'amount',
                        line: i
                    });
                    return Number(lineRate);
                }
            }
            return 0;
        }
        // automatically log function entry/exit for diagnostics. Here all functions exported in namespace "X" will autolog
        LogManager.autoLogMethodEntryExit({ target: X, method: /\w+/ }, {
            // IMPORTANT
            withArgs: false,
            withGovernance: true
        });
    })(X || (X = {}));
    return {
        afterSubmit: X.afterSubmit,
        beforeSubmit: X.beforeSubmit
    };
});
