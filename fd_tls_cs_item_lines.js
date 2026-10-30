// /// <reference path="../../../../../node_modules/@hitc/netsuite-types/SuiteScriptV1.d.ts" />
// /// <reference path="../../../../../node_modules/@types/ramda/index.d.ts" />

var range = function (start, end, step) {
    if (step === undefined) step = 1;
    const result = [];
    if (step === 0) { throw new Error('Step cannot be zero'); }
    if (start < end) {
        for (var i = start; i < end; i += step) {
            result.push(i);
        }
    }

    return result;
}

var getItemLineFields = function () {
    var linesRange = range(1, nlapiGetLineItemCount('item') + 1);
    var items = linesRange.map(function (m) {
        return {
            line: m,
            itemid: nlapiGetLineItemValue('item', 'item', m),
            quantity: Number(nlapiGetLineItemValue('item', 'quantity', m)),
            quantityfulfilled: nlapiGetLineItemValue('item', 'quantityfulfilled', m),
            quantitybilled: nlapiGetLineItemValue('item', 'quantitybilled', m),
            woid: nlapiGetLineItemValue('item', 'woid', m),
            group: nlapiGetLineItemText('item', 'custcol_fd_tls_item_group', m),
            collection: nlapiGetLineItemText('item', 'custcol_mb_so_collection', m),
            pricelevelText: nlapiGetLineItemValue('item', 'price_display', m),
            pricelevel: Number(nlapiGetLineItemValue('item', 'price', m)),
        };
    })
    return items;
}

var recalcTLS = function (type) {
    // var isCreate = !Boolean(getQueryParam('id'));
    // @ts-ignore
    if (window.allowSaveTLS) {
        return true;
    }

    try {
        var items = getItemLineFields();
        var accessories = items.filter(function (item) { return (item.collection === 'REV') && item.pricelevelText === 'Base Price'; });
        var itemSearch;
        // // Search returns undefined as the accessory transform feature was deprecated
        // var newcomers = items.filter(function (item) { return (item.group === 'SAMPLE') && !item.woid && Number(item.quantityfulfilled) === 0 && Number(item.quantitybilled) === 0; });
        // if (newcomers.length) {
        //     var duration = new Date().getTime();
        //     var itemIdList = R.uniq(R.map(R.prop('itemid'), newcomers));
        //     itemSearch = nlapiSearchRecord("item", null, [
        //         ["internalid", "anyof", itemIdList], "AND",
        //         ["custitem_yy_accessorytransform", "noneof", "@NONE@"]
        //     ], [
        //         new nlobjSearchColumn("internalid"),
        //         new nlobjSearchColumn("custitem_yy_accessorytransform")
        //     ]);
        //     console.log('nlapiSearchRecord() ' + (new Date().getTime() - duration) + 'ms;');
        // }
        if (!accessories.length || !itemSearch) { return true; }
        setTimeout(function () {
            try {
                // if (itemSearch) { transformAccessoryItems(newcomers, itemSearch); }
                if (accessories.length) { setAccessoryPriceLevels(items, accessories); }
                nlapiRefreshLineItems('item');
                // return true;
                // @ts-ignore
                window.allowSaveTLS = true;
                document.getElementById("btn_secondarymultibutton_submitter").click();
            }
            catch (e) {
                nlapiLogExecution('DEBUG', 'setTimeout ERROR_SAVING', e.message);
                window.allowSaveTLS = true;
                document.getElementById("btn_secondarymultibutton_submitter").click();
            }
        }, 100);
    }
    catch (e) {
        nlapiLogExecution('DEBUG', 'ERROR_SAVING', e.message);
        return true;
    }
};

var transformAccessoryItems = function (items, itemSearch) {

    itemSearch.forEach((function (m) {
        var itemId = m.getValue('internalid');
        var tranformItemId = m.getValue('custitem_yy_accessorytransform');
        var displayName = m.getText('custitem_yy_accessorytransform');
        items.filter(function (f) { return f.itemid === itemId; }).forEach(function (m) {
            console.log('setting line', m.line);
            console.log('tranformItemId', tranformItemId);
            console.log('displayName', displayName);

            // Log to the script page not just the console
            nlapiLogExecution('DEBUG', 'setting line ' + m.line + ': ' + nlapiGetRecordId(), displayName);
            // nlapiLogExecution('DEBUG', 'tranformItemId ' + nlapiGetRecordId(), tranformItemId);
            // nlapiLogExecution('DEBUG', 'displayName ' + nlapiGetRecordId(), displayName);
            nlapiSetLineItemValue('item', 'item', m.line, tranformItemId);
            nlapiSetLineItemValue('item', 'item_display', m.line, displayName);
        });
    }));
};

var setAccessoryPriceLevels = function (items, accessories) {

    var cabinets = items
        .filter(function (item) { return item.group === 'RTA' && !isNaN(Number(item.pricelevelText)); })
        .sort(function (a, b) { return Number(a.pricelevelText) - Number(b.pricelevelText); });
    console.log('accessories', accessories);
    console.log('cabinets', cabinets);
    var pl = cabinets && cabinets.length && cabinets[cabinets.length - 1].pricelevelText;

    if (!pl) {
        // Formerly function would return here but needed to be adjusted for REV items
        revItems = accessories.filter(function (item) { return item.collection === 'REV'; });
        // nlapiLogExecution('DEBUG', revItems.length, revItems);
        if (!revItems.length)
            return;
        nlapiLogExecution('DEBUG', 'No PL', 'Need to set to 2500 if REV as per Robert email');
        var revItemsAndPricing = R.groupBy(R.prop('itemid'), nlapiSearchRecord("item", null, [
            ["internalid", "anyof", R.uniq(R.map(R.prop('itemid'), revItems))], "AND",
            ["pricing.internalid", "anyof", 19]
        ], [
            new nlobjSearchColumn("pricelevel", "pricing", null),
            new nlobjSearchColumn("internalid", "pricing", null),
            new nlobjSearchColumn("item", "pricing", null),
            new nlobjSearchColumn("iteminternalid", "pricing", null),
            new nlobjSearchColumn("unitprice", "pricing", null)
        ]).map(function (m) {
            return ({
                priceleveltext: m.getText("pricelevel", "pricing", null),
                pricelevel: m.getValue("pricelevel", "pricing", null),
                itemid: m.getValue("iteminternalid", "pricing", null),
                rate: m.getValue("unitprice", "pricing", null),
            });
        }));

        revItems.forEach(function (revItem) {
            var price = R.pathOr(null, [revItem.itemid, 0])(revItemsAndPricing);
            nlapiSetLineItemValue('item', 'price', revItem.line, 19);
            // nlapiSetLineItemValue('item', 'price_display', f.line, pl);
            nlapiSetLineItemValue('item', 'rate', revItem.line, price.rate);
            nlapiSetLineItemValue('item', 'amount', revItem.line, price.rate * revItem.quantity);
        });
        return;
    }
    var plVal = R.pathOr('1', ['pricelevel'], R.last(cabinets)).toString();
    nlapiLogExecution('DEBUG', plVal, JSON.stringify(accessories));
    var accessoriesAndPricing = R.groupBy(R.prop('itemid'), nlapiSearchRecord("item", null, [
        ["internalid", "anyof", R.uniq(R.map(R.prop('itemid'), accessories))], "AND",
        ["pricing.internalid", "anyof", plVal]
    ], [
        new nlobjSearchColumn("pricelevel", "pricing", null),
        new nlobjSearchColumn("internalid", "pricing", null),
        new nlobjSearchColumn("item", "pricing", null),
        new nlobjSearchColumn("iteminternalid", "pricing", null),
        new nlobjSearchColumn("unitprice", "pricing", null)
    ]).map(function (m) {
        return ({
            priceleveltext: m.getText("pricelevel", "pricing", null),
            pricelevel: m.getValue("pricelevel", "pricing", null),
            itemid: m.getValue("iteminternalid", "pricing", null),
            rate: m.getValue("unitprice", "pricing", null),
        });
    }));
    nlapiLogExecution('DEBUG', 'checkpoint', pl);
    accessories.forEach(function (f) {
        nlapiLogExecution('DEBUG', 'pl', 'accessories')
        var price = R.pathOr(null, [f.itemid, 0])(accessoriesAndPricing);
        nlapiSetLineItemValue('item', 'price', f.line, plVal);
        nlapiSetLineItemValue('item', 'price_display', f.line, pl);
        if (price) {
            nlapiSetLineItemValue('item', 'rate', f.line, price.rate);
            nlapiSetLineItemValue('item', 'amount', f.line, price.rate * f.quantity);
        }
    });
};

// This was the original function before REV was added on 5/22/2023 - NK -


/*
var setAccessoryPriceLevels = function () {
    var linesRange = range(1, nlapiGetLineItemCount('item') + 1);
    var items = linesRange.map(function (m) { return ({
        line: m,
        itemid: nlapiGetLineItemValue('item', 'item', m),
        group: nlapiGetLineItemText('item', 'custcol_fd_tls_item_group', m),
        pricelevelText: nlapiGetLineItemValue('item', 'price_display', m),
        pricelevel: Number(nlapiGetLineItemValue('item', 'price', m)),
        woid: nlapiGetLineItemValue('item', 'woid', m),
        quantityfulfilled: nlapiGetLineItemValue('item', 'quantityfulfilled', m),
        quantity: Number(nlapiGetLineItemValue('item', 'quantity', m)),
    }); });
    var accessories = items.filter(function (f) { return f.group === 'ACCESSORY' && f.pricelevelText === 'Base Price'; });
    if (R.isEmpty(accessories))
        return;
    var cabinets = items
        .filter(function (f) { return f.group === 'RTA' && !isNaN(Number(f.pricelevelText)); })
        .sort(function (a, b) { return Number(a.pricelevelText) - Number(b.pricelevelText); });
    console.log('accessories', accessories);
    console.log('cabinets', cabinets);
    var pl = R.pathOr('', ['pricelevelText'], R.last(cabinets)).toString();
    if (!pl)
        return;
    var plVal = R.pathOr('1', ['pricelevel'], R.last(cabinets)).toString();
    console.log('setting accessory price level to ', pl);
    var accessoriesAndPricing = R.groupBy(R.prop('itemid'), nlapiSearchRecord("item", null, [
        ["internalid", "anyof", R.uniq(R.map(R.prop('itemid'), accessories))], "AND",
        ["pricing.internalid", "anyof", plVal]
    ], [
        new nlobjSearchColumn("pricelevel", "pricing", null),
        new nlobjSearchColumn("internalid", "pricing", null),
        new nlobjSearchColumn("item", "pricing", null),
        new nlobjSearchColumn("iteminternalid", "pricing", null),
        new nlobjSearchColumn("unitprice", "pricing", null)
    ]).map(function (m) { return ({
        priceleveltext: m.getText("pricelevel", "pricing", null),
        pricelevel: m.getValue("pricelevel", "pricing", null),
        itemid: m.getValue("iteminternalid", "pricing", null),
        rate: m.getValue("unitprice", "pricing", null),
    }); }));
    accessories.forEach(function (f) {
        var price = R.pathOr(null, [f.itemid, 0])(accessoriesAndPricing);
        nlapiSetLineItemValue('item', 'price', f.line, plVal);
        nlapiSetLineItemValue('item', 'price_display', f.line, pl);
        if (price) {
            nlapiSetLineItemValue('item', 'rate', f.line, price.rate);
            nlapiSetLineItemValue('item', 'amount', f.line, price.rate * f.quantity);
        }
    });
    nlapiRefreshLineItems('item');
};

*/
// var getQueryParam = function (name) {
//     var q = window.location.search.match(new RegExp('[?&]' + name + '=([^&#]*)'));
//     return q && q[1];
// };
