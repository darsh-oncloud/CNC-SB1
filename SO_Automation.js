/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/log', 'N/search'], function (record, log, search) {

    var DEFAULT_LOCATION_ID = 7;

    function post(context) {
        try {
            log.debug('Incoming Payload', JSON.stringify(context));

            if (isEmpty(context.user)) return err('MISSING_EMAIL', 'User email is missing.');
            if (isEmpty(context.otherrefnum)) return err('MISSING_PO', 'PO # / otherrefnum is missing.');

            var customerId = getCustomerByEmail(context.user);
            if (!customerId) return err('CUSTOMER_NOT_FOUND', 'Customer not found for email: ' + context.user);

            var itemList = context.item_list || [];
            if (!itemList.length) return err('NO_ITEMS', 'No item_list found in payload.');

            var otherRefNum = String(context.otherrefnum).trim();
            var locationId = getLocationId(context.location);

            if (!locationId) {
                return err('INVALID_LOCATION', 'Invalid location passed: ' + context.location);
            }

            log.debug('Header Values', {
                customerId: customerId,
                otherrefnum: otherRefNum,
                locationUsed: locationId
            });

            var quoteSearch = getQuotesByPO(otherRefNum);

            log.debug('Quote Search Result', quoteSearch);

            if (quoteSearch.count > 1) {
                return {
                    success: false,
                    name: 'MULTIPLE_QUOTES_FOUND',
                    message: 'Multiple Quotes found for PO # ' + otherRefNum + '. No record was created or updated.',
                    otherrefnum: otherRefNum,
                    matchCount: quoteSearch.count,
                    matchedQuotes: quoteSearch.quotes
                };
            }

            var quoteRec;
            var isUpdate = false;
            var existingQuote = quoteSearch.count === 1 ? quoteSearch.quotes[0] : null;

            if (existingQuote) {
                if (!isOpenStatus(existingQuote.status)) {
                    return {
                        success: false,
                        name: 'QUOTE_ALREADY_EXISTS',
                        message: 'Quote already exists for PO # ' + otherRefNum + ' but status is not Open. No record was created or updated.',
                        otherrefnum: otherRefNum,
                        quoteId: existingQuote.id,
                        quoteNumber: existingQuote.tranid,
                        status: existingQuote.status
                    };
                }

                isUpdate = true;

                quoteRec = record.load({
                    type: record.Type.ESTIMATE,
                    id: existingQuote.id,
                    isDynamic: true
                });

                var removedCount = removeAllLines(quoteRec);

                log.debug('Update Existing Quote', {
                    quoteId: existingQuote.id,
                    removedLineCount: removedCount
                });

            } else {
                quoteRec = record.create({
                    type: record.Type.ESTIMATE,
                    isDynamic: true
                });

                quoteRec.setValue({
                    fieldId: 'entity',
                    value: Number(customerId)
                });

                log.debug('Create New Quote', {
                    customerId: customerId
                });
            }

            quoteRec.setValue({
                fieldId: 'otherrefnum',
                value: otherRefNum
            });

            quoteRec.setValue({
                fieldId: 'location',
                value: locationId
            });

            if (!isEmpty(context.project_name)) {
                quoteRec.setValue({
                    fieldId: 'memo',
                    value: String(context.project_name)
                });
            }

            if (!isEmpty(context.zip)) {
                quoteRec.setValue({
                    fieldId: 'shipzip',
                    value: String(context.zip)
                });
            }

            var itemCache = {};
            var addedLines = [];

            for (var i = 0; i < itemList.length; i++) {
                var line = itemList[i];
                var itemId = line.ItemNumber;

                if (!itemId && !isEmpty(line.sku)) {
                    var sku = String(line.sku).trim();
                    itemId = itemCache[sku] || getItemBySku(sku);
                    itemCache[sku] = itemId;
                }

                if (!itemId) return err('ITEM_NOT_FOUND', 'Item not found. SKU: ' + line.sku);

                var qty = Number(line.quantity) || 1;

                quoteRec.selectNewLine({ sublistId: 'item' });

                quoteRec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    value: Number(itemId),
                    forceSyncSourcing: true
                });

                quoteRec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    value: qty
                });

              
              if (!isEmpty(line.options)) {
                    quoteRec.setCurrentSublistValue({
                              sublistId: 'item',
                              fieldId: 'custcol_mb_so_custom_modification',
                              value: String(line.options)
                    });
              }

              var colorCode = line.color_code || null;
                if (colorCode && Number(colorCode) >= 101 && Number(colorCode) <= 200) {
                    quoteRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_yy_mod_cplus_color',
                        value: Number(colorCode) - 80
                    });
                }


                quoteRec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'location',
                    value: locationId,
                    forceSyncSourcing: true
                });

                quoteRec.commitLine({ sublistId: 'item' });

                addedLines.push({
                    sku: line.sku,
                    itemId: itemId,
                    quantity: qty
                });
            }

            log.debug('Lines Added', addedLines);

            var quoteId = quoteRec.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });

            log.audit('Quote Saved', {
                quoteId: quoteId,
                mode: isUpdate ? 'updated_existing_quote' : 'created_new_quote',
                otherrefnum: otherRefNum
            });

            return {
                success: true,
                quoteId: quoteId,
                otherrefnum: otherRefNum,
                mode: isUpdate ? 'updated_existing_quote' : 'created_new_quote',
                message: isUpdate ? 'Existing open Quote updated successfully' : 'Quote created successfully',
                itemLineCount: addedLines.length,
                locationUsed: locationId
            };

        } catch (e) {
            log.error('RESTlet Error', e);

            return {
                success: false,
                name: e.name,
                message: e.message
            };
        }
    }

    function getLocationId(location) {
        if (isEmpty(location)) return DEFAULT_LOCATION_ID;

        var locationId = Number(String(location).trim());

        if (!locationId || isNaN(locationId)) return null;

        return locationId;
    }

    function getQuotesByPO(otherRefNum) {
        var quoteSearchObj = search.create({
            type: search.Type.ESTIMATE,
            filters: [
                ['mainline', 'is', 'T'],
                'AND',
                ['otherrefnum', 'equalto', String(otherRefNum)]
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'status' }),
                search.createColumn({ name: 'otherrefnum' }),
                search.createColumn({ name: 'entity' })
            ]
        });

        var paged = quoteSearchObj.runPaged({ pageSize: 1000 });
        var results = quoteSearchObj.run().getRange({ start: 0, end: 20 });
        var quotes = [];

        for (var i = 0; results && i < results.length; i++) {
            quotes.push({
                id: results[i].getValue({ name: 'internalid' }),
                tranid: results[i].getValue({ name: 'tranid' }),
                status: results[i].getText({ name: 'status' }) || results[i].getValue({ name: 'status' }),
                otherrefnum: results[i].getValue({ name: 'otherrefnum' }),
                customer: results[i].getText({ name: 'entity' })
            });
        }

        return {
            count: paged.count,
            quotes: quotes
        };
    }

    function removeAllLines(recObj) {
        var count = recObj.getLineCount({ sublistId: 'item' });

        for (var i = count - 1; i >= 0; i--) {
            recObj.removeLine({
                sublistId: 'item',
                line: i,
                ignoreRecalc: true
            });
        }

        return count;
    }

    function getCustomerByEmail(email) {
        var s = search.create({
            type: search.Type.CUSTOMER,
            filters: [['email', 'is', String(email)]],
            columns: [search.createColumn({ name: 'internalid' })]
        });

        var r = s.run().getRange({ start: 0, end: 1 });

        return r && r.length ? r[0].getValue({ name: 'internalid' }) : null;
    }

    function getItemBySku(sku) {
        var s = search.create({
            type: search.Type.ITEM,
            filters: [['itemid', 'is', String(sku)]],
            columns: [search.createColumn({ name: 'internalid' })]
        });

        var r = s.run().getRange({ start: 0, end: 1 });

        return r && r.length ? r[0].getValue({ name: 'internalid' }) : null;
    }

    function isOpenStatus(status) {
        return !isEmpty(status) && String(status).toLowerCase().indexOf('open') !== -1;
    }

    function isEmpty(v) {
        return v === null || v === undefined || String(v).trim() === '';
    }

    function err(name, message) {
        log.error(name, message);

        return {
            success: false,
            name: name,
            message: message
        };
    }

    return {
        post: post
    };
});