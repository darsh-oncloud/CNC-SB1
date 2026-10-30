define(["require", "exports", "N/search", "N/log", "N/runtime", "N/record", "N/query"], function (require, exports, search, log, runtime, record, query) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.beforeSubmit = beforeSubmit;
    /**
     * @NApiVersion 2.1
     * @NScriptType UserEventScript
     */
    function setShippingCost(context) {
        const { newRecord, oldRecord } = context;
        // Keeping the record variable name "currentRecord"
        // so that it is consistent with the client script
        const currentRecord = newRecord;
        var override = currentRecord.getValue('custbody_mb_gas_charge_override');
        if (override) {
            return true;
        }
        const entity = currentRecord.getValue('entity');
        if (entity == '921') {
            // As per Yosef he will set the ship cost for this customer manually
            return true;
        }
        var subtotal = Number(currentRecord.getValue('subtotal') || 0);
        var shipmethod = currentRecord.getValue('shipmethod');
        var freightIncluded = currentRecord.getValue('custbody16');
        var discountitem = currentRecord.getValue('discountitem');
        if (!entity) {
            // Likely xedit which we may need to cover for (unless you can't xedit shipcost) but leaving it for now
            return;
        }
        if (subtotal <= 0 || freightIncluded || discountitem == '67258' || ['80326', '62060', '68503'].includes(String(shipmethod))) {
            var shippingcost = Number(currentRecord.getValue('shippingcost') || 0);
            if (!shippingcost)
                return true;
            var tranid = currentRecord.getValue('tranid');
            var reason = '';
            if (freightIncluded) {
                reason = 'Freight Included';
            }
            else if (['80326', '62060', '68503'].includes(String(shipmethod))) {
                reason = 'Pickup';
            }
            else if (subtotal <= 0) {
                reason = 'Subtotal 0';
            }
            currentRecord.setValue({ fieldId: 'shippingcost', value: 0 });
            log.debug(`@setShippingCost: ${tranid} SHIPPING OVERRIDDEN (${reason})`, `Old Value: ${shippingcost}; New Value: 0;`);
            return true;
        }
        var cubicfeet = 0;
        var assembled = false;
        let exempt = 0;
        var tariffs = 0;
        // Subtotal field is not updated with the changes in countertop price at this point so calculating manually
        var calculated = 0;
        var lineCount = currentRecord.getLineCount({ sublistId: 'item' });
        for (var line = 0; line < lineCount; line++) {
            var item = String(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: line }));
            var quantity = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: line }) || 0);
            var itemtype = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: line });
            if (itemtype != 'Subtotal') {
                calculated += Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line }));
            }
            var columns = ['custitem_mb_cubicfeet'];
            if (!assembled) {
                columns = columns.concat(['custitem_mb_item_group', 'custitem_mb_item_assembled']);
            }
            const results = search.lookupFields({ type: search.Type.ITEM, id: item, columns });
            var { custitem_mb_cubicfeet, custitem_mb_item_group, custitem_mb_item_assembled } = results;
            var lineCubicfeet = Number(custitem_mb_cubicfeet) || 0;
            var lineAssembled = Number(custitem_mb_item_assembled?.[0]?.value || 0);
            var group = custitem_mb_item_group && custitem_mb_item_group[0] && custitem_mb_item_group[0].value;
            cubicfeet += quantity * lineCubicfeet;
            if (group == 1 && lineAssembled == 1 && !assembled) {
                assembled = true;
            }
            if (['91214', '399590'].includes(item)) { // Maritime, Storage Fee
                exempt += Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line }));
            }
            if (item == '307591') {
                const createddate = new Date(String(currentRecord.getValue({ fieldId: 'createddate' })) || new Date());
                if (createddate.getTime() >= new Date('6/17/2025, 1:00 PM').getTime() - 10800000) {
                    tariffs += Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line }) || 0);
                }
            }
        }
        // Hopefully the calculated shipping total does not get messed up if there are discount and markup lines
        if (subtotal != parseFloat(calculated.toFixed(2))) {
            const tranid = String(newRecord.getValue('tranid'));
            log.audit(`@setShippingCost: Subtotal Diff =${tranid}`, `subtotal: ${subtotal} | calculated: ${calculated}`);
        }
        var discounttotal = Number(currentRecord.getValue('discounttotal') || 0);
        var shipping = 0;
        cubicfeet = Math.floor(cubicfeet / 500) - 1;
        // CNC TRUCK
        if (['97162', '16', '119413'].includes(String(shipmethod))) {
            // ALWA Does not pay shipping for orders less than $1000
            // (Hardcoding this is terrible but I don't want to add a field to the customer record for just one customer,
            // the other alternative is to make a new record to store this info and link it to the customer)
            subtotal = Number(subtotal) || 0;
            if (String(entity) === '3781' && subtotal < 1000) {
                return;
            }
            var { custentity_mb_markup } = search.lookupFields({ type: search.Type.ENTITY, id: entity, columns: ['custentity_mb_markup'] });
            var markup = Number(String(custentity_mb_markup).replace('%', '') || 0) / 100;
            if (!markup) {
                var shippingcost = Number(currentRecord.getValue('shippingcost') || 0);
                if (shippingcost) {
                    var tranid = currentRecord.getValue('tranid');
                    currentRecord.setValue({ fieldId: 'shippingcost', value: 0 });
                    log.debug(`@setShippingCost: ${tranid} SHIPPING OVERRIDDEN (Gas Fee Not Set On Customer)`, `Old Value: ${shippingcost}; New Value: 0;`);
                }
                return true;
            }
            if (cubicfeet > 0) {
                shipping = cubicfeet * 500;
                currentRecord.setValue({ fieldId: 'shippingcost', value: shipping });
            }
            else {
                const gasfee = Number(currentRecord.getValue('custbody_yy_so_gasfee')) / 100;
                shipping = (calculated - exempt - tariffs) * gasfee;
                const location = currentRecord.getValue('location');
                var minimumShipping = Number(search.lookupFields({ type: search.Type.LOCATION, id: location, columns: ['custrecord_yy_shippingminimum'] }).custrecord_yy_shippingminimum || 0);
                var maximumShipping = 500;
                if (shipping > maximumShipping) {
                    shipping = maximumShipping;
                }
                else if (shipping < minimumShipping && !['1180', '920', '921'].includes(String(entity))) {
                    shipping = minimumShipping;
                }
                log.debug('@setShippingCost: shippingcost', currentRecord.getValue('shippingcost'));
                currentRecord.setValue({ fieldId: 'shippingcost', value: shipping });
                log.debug(`@setShippingCost: CNC Truck Shipping Cost Set: ${shipping}`, `subtotal: ${calculated}`);
            }
        }
        else if (shipmethod == '4640') { // COMMON CARRIER
            var { custentity_yy_shiprate } = search.lookupFields({ type: search.Type.ENTITY, id: entity, columns: ['custentity_yy_shiprate'] });
            var shiprate = Number(String(custentity_yy_shiprate).replace('%', '')) / 100;
            // Only CLIQ as of 7/31/2024 (and EXP-MIDWEST as of 2026).
            if (shiprate) {
                const storageLine = currentRecord.findSublistLineWithValue({ sublistId: 'item', fieldId: 'item', value: '399590' });
                if (storageLine != -1) {
                    const storageAmount = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: storageLine }));
                    subtotal -= storageAmount;
                }
                const tariffLine = currentRecord.findSublistLineWithValue({ sublistId: 'item', fieldId: 'item', value: '307591' });
                if (tariffLine != -1) {
                    const tariffAmount = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: tariffLine }));
                    // Subtract tariff line (unless the customer is EXP-MIDWEST-VA per https://cnccabinetry.freshdesk.com/a/tickets/12557)
                    if (entity != 199691) {
                        subtotal -= tariffAmount;
                    }
                    else { // Because any scripted before submit updates to the tariff line are not reflected in the subtotal
                        const oldTariffLine = Number(oldRecord?.findSublistLineWithValue({ sublistId: 'item', fieldId: 'item', value: '307591' })) || -1;
                        const oldTariffAmount = oldTariffLine == -1 ? 0 : Number(oldRecord?.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: oldTariffLine })) || 0;
                        log.debug(String(oldTariffAmount), tariffAmount);
                        subtotal = subtotal - oldTariffAmount + tariffAmount;
                    }
                }
                shipping = (subtotal - discounttotal) * shiprate;
                currentRecord.setValue({ fieldId: 'shippingcost', value: shipping });
            }
        }
        if (assembled && entity == '39390') {
            log.debug('@setShippingCost: [assembled, entity]', [assembled, entity]);
            // This customer will generally try to order unassembled cabinets when shipping with common carrier to save money on freight (and assembly)
            // In the event that they order assembled cabinets or for FedEx shipping this will override their 10% upcharge and replace with 15%
            // Subtract tariff line
            const storageLine = currentRecord.findSublistLineWithValue({ sublistId: 'item', fieldId: 'item', value: '399590' });
            if (storageLine != -1) {
                const storageAmount = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: storageLine }));
                subtotal -= storageAmount;
            }
            const tariffLine = currentRecord.findSublistLineWithValue({ sublistId: 'item', fieldId: 'item', value: '307591' });
            if (tariffLine != -1) {
                const tariffAmount = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: tariffLine }));
                subtotal -= tariffAmount;
            }
            // Replace with manually calculated subtotal just like with CNC Truck
            shipping = subtotal * 0.15;
            currentRecord.setValue({ fieldId: 'shippingcost', value: shipping });
        }
        var shippingcost = Number(currentRecord.getValue('shippingcost') || 0);
        if (shippingcost) {
            var tranid = currentRecord.getValue('tranid');
            // This log should match unless shippingcost was entered manually
            if (shippingcost != shipping) {
                log.debug(`@setShippingCost: ${tranid}`, `${shippingcost}, ${shipping}`);
            }
        }
        // If no shipping was set yet leave the manual amount.
        return true;
    } // Support function for NKSSCCSetShippingAndCountertopCost
    function setHandlingCost(context) {
        var { newRecord } = context;
        var currentRecord = newRecord;
        var handlingcost = Number(currentRecord.getValue({ fieldId: 'handlingcost' }) || 0);
        // Failsafe field saves the value in case of the NS bug that randomly clearing site fees
        var custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
        if ((handlingcost || custbody_yy_so_handlingcost) && handlingcost != custbody_yy_so_handlingcost) {
            log.debug(`@setHandlingCost: handlingcost: ${handlingcost}`, `custbody_yy_so_handlingcost: ${custbody_yy_so_handlingcost}`);
        }
        currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
        // Manual site fee
        var override = currentRecord.getValue('custbody_yy_so_nositefee');
        // Check if customer doesn't pay site fee
        var entity = Number(currentRecord.getValue('entity'));
        let customerExclusion = query.runSuiteQL({
            query: `
        SELECT custentity_rsm_excl_from_site_fee AS excl
        FROM customer
        WHERE id = '${entity}'
      `
        }).asMappedResults();
        if (override || (customerExclusion[0] && customerExclusion[0].excl === 'T')) {
            return true;
        }
        var shipmethod = currentRecord.getValue('shipmethod');
        // Customer pick up (no site fee)
        if (['80326', '62060', '68503'].includes(String(shipmethod))) { // Express, Pick Up, CPU (Customer Pick Up)
            currentRecord.setValue({ fieldId: 'custbody_yy_so_handlingcost', value: 0 });
            custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
            currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
            return true;
        }
        var subtotal = Number(currentRecord.getValue('subtotal') || 0);
        var discounttotal = Number(currentRecord.getValue('discounttotal') || 0);
        subtotal -= Math.abs(discounttotal);
        var freightIncluded = currentRecord.getValue('custbody16');
        var discountitem = currentRecord.getValue('discountitem');
        if (!entity) {
            // Likely xedit which we may need to cover for but leaving it for now
            custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
            currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
            return true;
        }
        // TODO: Retrieve these values from the above customer query instead
        var entityFields = search.lookupFields({ type: search.Type.ENTITY, id: entity, columns: ['custentity_mb_markup', 'custentity_yy_shiprate'] });
        // markup: cncTruckMarkup
        var markup = entityFields.custentity_mb_markup;
        markup = Number(String(markup).replace('%', '')) / 100;
        let location = Number(currentRecord.getValue({ fieldId: 'location' }));
        let source = currentRecord.getValue({ fieldId: 'source' });
        let trandate = currentRecord.getValue({ fieldId: 'trandate' });
        if (subtotal <= 0 || freightIncluded || !markup || discountitem == '67258' || ['80326', '62060', '68503'].includes(String(shipmethod))) {
            currentRecord.setValue({ fieldId: 'custbody_yy_so_handlingcost', value: 0 });
            custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
            currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
            return true;
        }
        //
        else if ((shipmethod == '97162' || shipmethod == 16) && location === 7 && source !== 'Web (Cabnet by CNC Cabinetry)' && new Date(String(trandate)) > new Date('06-16-2025')) { //if inside delivery or CNC Truck
            let fee = 0;
            let zipcode = currentRecord.getValue({ fieldId: 'shipzip' });
            let results = query.runSuiteQL({
                query: `
          SELECT custrecord_ata_congestion AS mprice, custrecord_ata_crz_zip AS cprice
          FROM customrecord_fd_ata_zipcode
          WHERE custrecord_ata_zipcode = '${zipcode}'
        `
            }).asMappedResults();
            if (shipmethod == '97162') { //if it's inside delivery
                // We may need to make adjustments for these prices in the event of inside delivery for default shipping addresses
                if (results[0] && results[0].mprice == 'T') { //if the zip is in manhattan
                    fee = 325;
                }
                else {
                    fee = 200;
                }
                if (results[0] && results[0].cprice == 'T') { //if the current zipcode is one of the manhattan congestion fee zips then add on a $13 charge
                    fee += 13;
                }
            }
            else if (String(shipmethod) == '16') { //any order using CNC truck
                let shipaddress = currentRecord.getValue({ fieldId: 'shipaddress' });
                let entity = currentRecord.getValue({ fieldId: 'entity' });
                // Check in case of slowdowns due to multiple joins (remove this log once reasonable numbers come in consistently)
                let companyAddressesResults = query.runSuiteQL({
                    query: `
            SELECT addrtext, defaultshippingaddress, addressbookaddress, custrecord_rsm_primary_address AS primary
                FROM customeraddressbook
                JOIN customeraddressbookentityaddress ON customeraddressbook.addressbookaddress = customeraddressbookentityaddress.nkey
                JOIN customer ON customer.id = customeraddressbook.entity
                WHERE 
                entity = '${entity}' AND (
                    customeraddressbook.addressbookaddress = customer.defaultshippingaddress
                    OR custrecord_rsm_primary_address = 'T'
                )
        `
                }).asMappedResults();
                // If a customer has a primary address or multiple then do not include the NS native default address
                const hasPrimaryAddress = companyAddressesResults.some(addr => addr.primary === 'T');
                if (hasPrimaryAddress) {
                    companyAddressesResults = companyAddressesResults.filter(addr => addr.primary === 'T');
                }
                const normalize = s => String(s).replace(/\s+/g, ' ').trim();
                const companyAddresses = companyAddressesResults.map(addr => normalize(addr.addrtext));
                log.debug('@setHandlingCost: companyAddresses', companyAddresses);
                // There are often whitespace mismatches
                if (!companyAddresses.includes(normalize(shipaddress))) { //if the order isn't the default address
                    let EXP = [1003, 21423, 12053, 1006]; //all EXP customers
                    // Commented out due to many incorrect default shipping addresses (consider using the new Primary Address custom field instead)
                    // fee = EXP.includes(entity) ? 100 : 125; //EXP gets a $100 site fee starting 06-24-2025
                    if (results[0].mprice == 'T') { //if cnc truck and manhattan
                        fee = 225;
                    }
                    if (results[0].cprice == 'T') { //if the current zipcode is one of the manhattan congestion fee zips then add on a $13 charge
                        fee += 13;
                    }
                }
            }
            const createddate = new Date(String(currentRecord.getValue({ fieldId: 'createddate' })) || new Date());
            if (createddate >= new Date('06-16-2025')) { //Only add fee to orders created on or after June 16, 2025 = When this started
                // Do not remove fee (when empty) from orders where it was already set before (mainly due to wrong default ship addresses)
                if (fee) {
                    currentRecord.setValue({ fieldId: 'custbody_yy_so_handlingcost', value: fee });
                    custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
                    currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
                }
            }
            return true;
            // Archived query from before we started using the primary address field
            // let defaultAddressResults = query.runSuiteQL({
            //     query: `
            //     SELECT  cab.addrtext
            //     FROM customeraddressbookentityaddress cab
            //     WHERE cab.nkey = (SELECT defaultshippingaddress FROM customer WHERE id = '${entity}' )
            // `}).asMappedResults();
        }
        handlingcost = Number(currentRecord.getValue({ fieldId: 'handlingcost' }));
        custbody_yy_so_handlingcost = currentRecord.getValue({ fieldId: 'custbody_yy_so_handlingcost' });
        if ((handlingcost || custbody_yy_so_handlingcost) && handlingcost != custbody_yy_so_handlingcost) {
            log.debug(`@setHandlingCost: handlingcost: ${handlingcost}`, `custbody_yy_so_handlingcost: ${custbody_yy_so_handlingcost}`);
            currentRecord.setValue({ fieldId: 'handlingcost', value: custbody_yy_so_handlingcost });
        }
        return true;
    } // Support function for NKSSCCSetShippingAndCountertopCost
    function clearClosedLineCost(context) {
        var { newRecord } = context;
        var currentRecord = newRecord;
        var lineCount = currentRecord.getLineCount({ sublistId: 'item' });
        var linesClosed = [];
        for (var line = 0; line < lineCount; line++) {
            var isclosed = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: line });
            if (isclosed) {
                linesClosed.push(line); // Consolidate for logs
                var amount = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line });
                // If the line was just closed clear the cost and move it to a custom field
                if (amount) {
                    // Exit if this function was called from a client script the return value signals that tax needs to recalculate
                    if (!currentRecord.setSublistValue) {
                        return true;
                    }
                    log.debug('@clearClosedLineCost: amount', amount);
                    // Save the amount prior to close to a custom field so we can put it back if the line reopens
                    currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: line, value: 0 });
                    currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol6', line: line, value: amount });
                }
            }
            else if (!isclosed) {
                // Exit if this function was called from a client script the return value signals that tax needs to recalculate
                if (!currentRecord.setSublistValue) {
                    return true;
                }
                var closedAmount = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol6', line });
                // If the line was just reopened reenter the cost saved in the custom field
                if (closedAmount) {
                    currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: line, value: closedAmount });
                    currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol6', line: line, value: 0 });
                    // Uncheck "Paid in Full" as we added a the item's cost's to the lines, the (Sales Order Defaults) workflow will recheck it if needed.
                    currentRecord.setValue({ fieldId: 'custbody_mb_paid_in_full', value: false });
                    const terms = currentRecord.getValue('terms');
                    if (terms == 9) { // Change Paid In Full status back to CIA. (Oddly, a CIA order's terms change to "Paid In Full" when paid even though it's tecnically not its own term)
                        currentRecord.setValue({ fieldId: 'terms', value: 7 });
                    }
                }
            }
        }
        if (linesClosed.length) {
            var tranid = currentRecord.getValue('tranid');
            log.debug('@clearClosedLineCost: sales order with closed lines saved', `${tranid} line: ${linesClosed.join(', ')}`);
        }
    } // Support function for NKSSCCSetShippingAndCountertopCost
    function setCountertopCost(context) {
        var { newRecord, type } = context;
        var currentRecord = newRecord;
        var tranid = currentRecord.getValue('tranid');
        var lineCount = currentRecord.getLineCount({ sublistId: 'item' });
        for (var line = 0; line < lineCount; line++) {
            var collection = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: line }); // YY
            var description = String(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'description', line: line }));
            if (collection == 9 || description.endsWith("EDGEBAND")) { // YY added description
                var total = 0;
                var rate = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: line }) || 0);
                var quantity = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: line }) || 0);
                var uom = Number(currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_uom', line: line }) || 0);
                if (uom) {
                    // As per Jennifer 3/26/2025 DIRSUP minimum is 2 not 3 (see helpdesk ticket 8952). If additional child customers of DIRSUP get entered the script will need to include them
                    var entity = currentRecord.getValue('entity');
                    var createddate = currentRecord.getValue('createddate') || currentRecord.getValue('datecreated');
                    var minimum = [920, 921].includes(Number(entity)) && new Date(String(createddate)).getTime() > new Date('3/26/2025 1:00 pm').getTime() ? 2 : 3;
                    if (uom > minimum || description.endsWith("EDGEBAND")) {
                        total = quantity * uom * rate;
                    }
                    else {
                        total = quantity * minimum * rate;
                    }
                    var oldTotal = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line }) || 0;
                    if (!currentRecord.setSublistValue) { // Client script
                        return true;
                    }
                    currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: line, value: total });
                    if (parseFloat(total.toFixed(2)) != oldTotal) {
                        if (type == context.UserEventType.CREATE || !oldTotal) {
                            log.debug(`@setCountertopCost: ${tranid} Countertop Amount Set`, currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: line }));
                        }
                        else {
                            log.debug(`@setCountertopCost: ${tranid} COUNTERTOP AMOUNT CHANGED`, `Old Value: ${oldTotal}; New Value: ${total}`);
                        }
                    }
                }
            }
        }
    } // Support function for NKSSCCSetShippingAndCountertopCost
    function addModificationCharges(context) {
        const newRecord = context.newRecord;
        const orderstatus = newRecord.getValue('orderstatus');
        const chargeApplied = newRecord.getValue('custbody_ah_charges_applied');
        if (orderstatus == 'G') {
            return;
        }
        automateBlumChargeOnly(context, chargeApplied);
        try {
            if ([156044, 7097].includes(runtime.getCurrentUser().id)) {
                log.debug('Current User', runtime.getCurrentUser().id);
                automateEdgebandCharge(context, chargeApplied);
            }
        }
        catch (e) {
            log.error('@automateEdgebandCharge', e.message + ' stack: ' + e.stack);
        }
        try {
            automateReededCharges(context, chargeApplied);
        }
        catch (e) {
            log.error('@automateReededCharges', e.message);
        }
    }
    function automateEdgebandCharge(context, chargeApplied) {
        let newRecord = context.newRecord;
        let chargeItem = 429827;
        //let chargeItem = 309756; //sb2 item
        let source = newRecord.getValue({ fieldId: 'source' });
        //let chargeApplied = newRecord.getValue({ fieldId: 'custbody_ah_charges_applied' }); //if the charge was already added to the order
        if (source === 'Web (Cabnet by CNC Cabinetry)') { //if cabnet order don't apply charges
            chargeApplied = true; //Cabnet sets charges already
        }
        let charge = 0;
        let lineCount = newRecord.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < lineCount; i++) { //mark all the line items if blum or not
            //right now blum option (in Netsuite) is available for most items but if it's not then have to check if the field exists first
            var edgebandOptions = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_mod_edgeband', line: i });
            let curItem = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
            let itemtype = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
            if (edgebandOptions !== '1' && (itemtype === 'Assembly' || itemtype === 'InvtPart')) { //when click into mods all other available mods give a weird icon as the value
                continue;
            }
            else { //there's an edgeband
                if (edgebandOptions === '1' && !chargeApplied) { //if blum, set to true
                    let amount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
                    charge += amount * .1; //10% upcharge on each blum upgrade item.
                }
                if (curItem === -2 && !chargeApplied && charge > 0) { //if it's a subtotal item
                    log.debug('@EdgebandBeforeSubmit: subtotal item', curItem);
                    newRecord.insertLine({ sublistId: 'item', line: i });
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: i, value: chargeItem });
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: i, value: charge });
                    newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true }); //set to true if added here (will still be able to add the rest)
                    lineCount = newRecord.getLineCount({ sublistId: 'item' });
                    i++; //prevent from running on a subtotal line again and inserting many blum charge lines
                    charge = 0;
                }
                if (itemtype === 'Discount' && !chargeApplied) {
                    let prevItem = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i - 1 }));
                    if (!(prevItem === -2)) { //make sure this is not a discount after a subtotal
                        let prevItemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i - 1 });
                        let subtractNum = 1; //amount of lines to go back after a discount (there may be a charge)
                        while (prevItemType !== 'Assembly' && prevItemType !== 'InvtPart') {
                            subtractNum++;
                            prevItemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i - subtractNum });
                        }
                        let itemAmount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i - subtractNum }));
                        charge -= itemAmount * .1; //remove the amount that was already added to the charge variable
                        let discountAmount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
                        let subtotal = itemAmount + discountAmount;
                        charge += subtotal * .1; //add on the charge after the discount is applied
                    }
                }
            }
        }
        if (charge > 0) { //if there's a charge still, add it to the bottom of the order
            log.debug('eb line count before charge', newRecord.getLineCount({ sublistId: 'item' }));
            newRecord.insertLine({ sublistId: 'item', line: lineCount });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: lineCount, value: chargeItem });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: lineCount, value: charge });
            newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true });
            lineCount = newRecord.getLineCount({ sublistId: 'item' });
            log.debug('eb line count after charge', newRecord.getLineCount({ sublistId: 'item' }));
            charge = 0;
            log.debug('new charge item', newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: lineCount - 1 }));
        }
    }
    function automateBlumChargeOnly(context, chargeApplied) {
        let newRecord = context.newRecord;
        let chargeItem;
        chargeItem = 306578;
        let source = newRecord.getValue({ fieldId: 'source' });
        // let standardBlum = [348, 518, 396, 395, 519, 398, 397, 586, 578, 576, 577, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541, 542, 543, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531];
        //let chargeApplied = newRecord.getValue({ fieldId: 'custbody_ah_charges_applied' }); //if the charge was already added to the order
        const customer = String(newRecord.getValue({ fieldId: 'entity' }));
        const classicExemptCustomers = ['1003']; //EXP is exempt from blum on classic cabinets
        /* if (exemptCustomers.includes(customer)) {
            chargeApplied = true; //EXEMPT from charges
        } */
        if (source === 'Web (Cabnet by CNC Cabinetry)') { //if cabnet order don't apply charges
            chargeApplied = true; //Cabnet sets charges already
        }
        let charge = 0;
        let lineCount = newRecord.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < lineCount; i++) { //mark all the line items if blum or not
            //right now blum option (in Netsuite) is available for most items but if it's not then have to check if the field exists first
            var blumOptions = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_yy_mod_blumhinges', line: i });
            let curItem = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
            let itemtype = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
            let collection = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_mb_so_collection', line: i }));
            if (collection === 2 && classicExemptCustomers.includes(customer)) {
                chargeApplied = true; //EXEMPT from charges if it's a classic cabinet and the customer is in the exempt list
            }
            //log.debug('@AHBlumueBeforeSubmit: itemtype', itemtype);
            //log.debug('@AHBlumueBeforeSubmit: blum options', blumOptions);
            if (blumOptions !== '1' && (itemtype === 'Assembly' || itemtype === 'InvtPart')) { //when click into mods all other available mods give a weird icon as the value
                continue;
            }
            else { //there's a blum upgrade
                if (blumOptions === '1') { //if blum, set to true
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_blum_hinges', line: i, value: true });
                    if (!chargeApplied) {
                        let amount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
                        charge += amount * .1; //10% upcharge on each blum upgrade item.
                    }
                }
                else if (newRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_blum_hinges', line: i })) {
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_ah_item_blum_hinges', line: i, value: false });
                }
                if (curItem === -2 && !chargeApplied && charge > 0) { //if it's a subtotal item
                    log.debug('@AHBlumueBeforeSubmit: subtotal item', curItem);
                    newRecord.insertLine({ sublistId: 'item', line: i });
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: i, value: chargeItem });
                    newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: i, value: charge });
                    newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true }); //set to true if added here (will still be able to add the rest)
                    lineCount = newRecord.getLineCount({ sublistId: 'item' });
                    i++; //prevent from running on a subtotal line again and inserting many blum charge lines
                    charge = 0;
                }
                if (itemtype === 'Discount' && !chargeApplied) {
                    let prevItem = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i - 1 }));
                    if (!(prevItem === -2)) { //make sure this is not a discount after a subtotal
                        let prevItemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i - 1 });
                        //log.debug('@AHBlumueBeforeSubmit: previtemtype', prevItemType);
                        let subtractNum = 1; //amount of lines to go back after a discount (there may be a charge)
                        while (prevItemType !== 'Assembly' && prevItemType !== 'InvtPart') {
                            subtractNum++;
                            prevItemType = newRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i - subtractNum });
                        }
                        let itemAmount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i - subtractNum }));
                        charge -= itemAmount * .1; //remove the amount that was already added to the charge variable
                        let discountAmount = Number(newRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
                        let subtotal = itemAmount + discountAmount;
                        charge += subtotal * .1; //add on the charge after the discount is applied
                    }
                }
            }
        }
        if (charge > 0) { //if there's a charge still, add it to the bottom of the order
            log.debug('blum line count before charge', newRecord.getLineCount({ sublistId: 'item' }));
            newRecord.insertLine({ sublistId: 'item', line: lineCount });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', line: lineCount, value: chargeItem });
            newRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: lineCount, value: charge });
            newRecord.setValue({ fieldId: 'custbody_ah_charges_applied', value: true });
            lineCount = newRecord.getLineCount({ sublistId: 'item' });
            charge = 0;
            log.debug('blum line count after charge', newRecord.getLineCount({ sublistId: 'item' }));
        }
    }
    function automateReededCharges(context, chargeApplied) {
        const newRecord = context.newRecord;
        const REEDED_FIELD = 'custcol_ap_mod_reeded';
        let lineCount = newRecord.getLineCount('item');
        let hasReededSelection = false;
        for (let line = 0; line < lineCount; line++) {
            let reededSelection = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: REEDED_FIELD,
                line
            });
            if (reededSelection && Number(reededSelection)) {
                hasReededSelection = true;
                break;
            }
        }
        if (!hasReededSelection) {
            log.debug('@automateReededCharges', 'No reeded selections found. Skipping.');
            return;
        }
        const REEDED_CONFIG = {
            TOP_DRAWER_CAB: { rate: 0.15, item: 425310 },
            TOP_DRAWER_DF: { rate: 1.00, item: 425313 },
            DOOR_CAB: { rate: 0.60, item: 425309 },
            DOOR_DR: { rate: 1.00, item: 425312 },
            BOTH_CAB: { rate: 0.60, item: 425311 },
            BOTH_DRDF: { rate: 1.00, item: 425314 }
        };
        const CHARGE_APPLIED_FIELD = 'custbody_ah_charges_applied';
        const DOOR_STYLE_FIELD = 'custitem_mb_item_style';
        const ALLOWED_DOOR_STYLES = [26, 34, 40];
        const REEDED_SELECTIONS = {
            DOOR_ONLY: '1',
            TOP_DRAWER_ONLY: '2',
            FULL_CABINET: '3'
        };
        const ITEM_TYPES = {
            DRDF: [5, 6, 17, 42],
        };
        const source = newRecord.getValue({ fieldId: 'source' });
        if (source === 'Web (Cabnet by CNC Cabinetry)') {
            chargeApplied = true;
        }
        if (chargeApplied)
            return;
        const itemIds = [];
        for (let line = 0; line < lineCount; line++) {
            const itemId = Number(newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line
            }));
            if (itemId && !itemIds.includes(itemId)) {
                itemIds.push(itemId);
            }
        }
        const itemDataMap = {};
        if (itemIds.length) {
            const results = query.runSuiteQL({
                query: `
                SELECT
                    id,
                    custitem_mb_item_style AS doorstyle,
                    custitem_mb_item_item_type AS itemtype
                FROM item
                WHERE id IN (${itemIds.join(',')})
            `
            }).asMappedResults();
            results.forEach(row => {
                itemDataMap[Number(row.id)] = {
                    doorStyle: Number(row.doorstyle),
                    itemType: Number(row.itemtype)
                };
            });
        }
        log.debug('@automateReededCharges: itemDoorStyleMap', itemDataMap);
        let chargeAmountByChargeItem = {};
        for (let i = 0; i < lineCount; i++) {
            const itemtype = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: i
            });
            if (itemtype == 'Subtotal') {
                if (hasCharges(chargeAmountByChargeItem)) {
                    i = insertChargesByItem(newRecord, i, chargeAmountByChargeItem);
                    newRecord.setValue({ fieldId: CHARGE_APPLIED_FIELD, value: true });
                    lineCount = newRecord.getLineCount({ sublistId: 'item' });
                    chargeAmountByChargeItem = {};
                }
                continue;
            }
            if (itemtype === 'Discount') {
                adjustChargesForDiscount(newRecord, i, chargeAmountByChargeItem);
                continue;
            }
            if (itemtype == 'Assembly' || itemtype == 'InvtPart') {
                let chargeConfig = getLineReededChargeDetails(newRecord, i);
                if (!chargeConfig)
                    continue;
                log.debug('@automateReededCharges: Checkpoint 6', chargeConfig);
                let amount = Number(newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'amount',
                    line: i
                })) || 0;
                addCharge(chargeAmountByChargeItem, chargeConfig.item, amount * chargeConfig.rate);
            }
        }
        log.debug('@automateReededCharges: Checkpoint 1', chargeAmountByChargeItem);
        if (hasCharges(chargeAmountByChargeItem)) {
            log.debug('@automateReededCharges: Checkpoint 1.5', newRecord.getLineCount('item'));
            insertChargesByItem(newRecord, 1, chargeAmountByChargeItem);
            log.debug('@automateReededCharges: Checkpoint 2', newRecord.getLineCount('item'));
            newRecord.setValue({ fieldId: CHARGE_APPLIED_FIELD, value: true });
        }
        function getLineReededChargeDetails(newRecord, line) {
            const reededSelection = String(newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: REEDED_FIELD,
                line
            }) || '');
            if (!reededSelection) {
                return;
            }
            log.debug('@automateReededCharges', 'Checkpoint 3');
            const itemId = Number(newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line
            }));
            // The charge for DR-DF items equals 100% of the item
            const itemType = itemDataMap[itemId].itemType;
            const isDrDf = ITEM_TYPES.DRDF.includes(itemType);
            if (reededSelection === REEDED_SELECTIONS.TOP_DRAWER_ONLY) {
                if (isDrDf)
                    return REEDED_CONFIG.TOP_DRAWER_DF;
                else
                    return REEDED_CONFIG.TOP_DRAWER_CAB;
            }
            if (reededSelection === REEDED_SELECTIONS.DOOR_ONLY) {
                if (isDrDf)
                    return REEDED_CONFIG.DOOR_DR;
                else
                    return REEDED_CONFIG.DOOR_CAB;
            }
            if (reededSelection === REEDED_SELECTIONS.FULL_CABINET) {
                if (isDrDf)
                    return REEDED_CONFIG.BOTH_DRDF;
                else
                    return REEDED_CONFIG.BOTH_CAB;
            }
        }
        function adjustChargesForDiscount(record, discountLine, chargesByItem) {
            const prevItem = Number(record.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: discountLine - 1
            }));
            if (prevItem === -2)
                return;
            let subtractNum = 1;
            let prevItemType = record.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: discountLine - subtractNum
            });
            while (prevItemType !== 'Assembly' &&
                prevItemType !== 'InvtPart' &&
                discountLine - subtractNum > 0) {
                subtractNum++;
                prevItemType = record.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemtype',
                    line: discountLine - subtractNum
                });
            }
            const itemLine = discountLine - subtractNum;
            const chargeConfig = getLineReededChargeDetails(record, itemLine);
            log.debug('@automateReededCharges: Checkpoint 4', chargeConfig);
            if (!chargeConfig)
                return;
            const itemAmount = Number(record.getSublistValue({
                sublistId: 'item',
                fieldId: 'amount',
                line: itemLine
            })) || 0;
            const discountAmount = Number(record.getSublistValue({
                sublistId: 'item',
                fieldId: 'amount',
                line: discountLine
            })) || 0;
            log.debug('@automateReededCharges', 'Checkpoint 5');
            addCharge(chargesByItem, chargeConfig.item, -(itemAmount * chargeConfig.rate));
            addCharge(chargesByItem, chargeConfig.item, (itemAmount + discountAmount) * chargeConfig.rate);
        }
        function addCharge(chargesByItem, itemId, amount) {
            chargesByItem[itemId] = (chargesByItem[itemId] || 0) + amount;
        }
        function hasCharges(chargesByItem) {
            return Object.keys(chargesByItem).some(function (itemId) {
                return roundMoney(chargesByItem[itemId]) > 0;
            });
        }
        function insertChargesByItem(record, startLine, chargesByItem) {
            let insertLine = startLine;
            log.debug('Checkpoint 7', chargesByItem);
            log.debug('Checkpoint 8', Object.keys(chargesByItem));
            Object.keys(chargesByItem).forEach(function (itemId) {
                let amount = roundMoney(chargesByItem[itemId]);
                log.debug('Checkpoint 9', amount);
                if (amount <= 0)
                    return;
                log.debug('Checkpoint 10', amount);
                record.insertLine({
                    sublistId: 'item',
                    line: insertLine
                });
                record.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: insertLine,
                    value: Number(itemId)
                });
                record.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'price',
                    line: insertLine,
                    value: -1 // "Custom"
                });
                record.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: insertLine,
                    value: 1
                });
                record.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: insertLine,
                    value: amount
                });
                record.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'amount',
                    line: insertLine,
                    value: amount
                });
                insertLine++;
            });
            log.debug('Checkpoint 11', insertLine);
            return insertLine;
        }
        function roundMoney(value) {
            return Math.round((Number(value) || 0) * 100) / 100;
        }
    }
    function beforeSubmit(context) {
        const { type, newRecord, oldRecord } = context;
        if (newRecord.type === record.Type.SALES_ORDER || newRecord.type === record.Type.ESTIMATE) {
            if (runtime.executionContext !== runtime.ContextType.WEBSERVICES && runtime.executionContext !== runtime.ContextType.WEBSTORE) {
                try {
                    if (type == context.UserEventType.DELETE)
                        return;
                    // Return from the function if it is a billed and closed sales orders unless they just closed the order in which case we need to adjust pricing for the closed lines. 
                    var status = newRecord.getValue('status');
                    var orderstatus = newRecord.getValue('orderstatus');
                    var previousstatus = oldRecord?.getValue('orderstatus');
                    if (status == 'Billed' && orderstatus == 'G' || orderstatus == 'H' && previousstatus == 'H') {
                        return;
                    }
                    // Because the tariff is included in the ship rate percentage for EXP-MIDWEST-VA, we need to have that script run first
                    // The function order is intentional (aside for setShippingCost and setHandlingCost which can run in any order (which still works better this way in case handling cost result in errors))
                    setCountertopCost(context);
                    addModificationCharges(context);
                    clearClosedLineCost(context);
                    setShippingCost(context);
                    setHandlingCost(context);
                }
                catch (e) {
                    log.error('@NKSSCCSetShippingAndCountertopCost', e.message);
                }
            }
        }
    }
});
