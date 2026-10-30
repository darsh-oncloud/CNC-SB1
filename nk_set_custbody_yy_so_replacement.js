function resetShipDateOnLines(context) {
    try {
        var lineCount = nlapiGetLineItemCount('item');
        var shipdate = nlapiGetFieldValue('shipdate');
        for (var line = 1; line <= lineCount; line++) {
            nlapiSetLineItemValue('item', 'expectedshipdate', line, shipdate);
        }
    } catch (e) { nlapiLogExecution('DEBUG', e.message); }
}
    
function getInternalId(context) {
    try {
        var tranid = nlapiGetFieldValue('custbody_yy_so_replacementfor');
        if (tranid && !nlapiGetFieldValue('custbody_yy_so_replacement')) {
            var filters = new Array();
            filters[0] = new nlobjSearchFilter('type', null, 'is', 'SalesOrd');
            filters[1] = new nlobjSearchFilter('tranid', null, 'is', tranid);
            filters[2] = new nlobjSearchFilter('mainline', null, 'is', 'T');
            var columns = new Array();
            columns[0] = new nlobjSearchColumn('internalid');
            var searchResults = nlapiSearchRecord('salesorder', null, filters, columns);
            if (searchResults) {
                var id = nlapiGetRecordId();
                var rec = nlapiLoadRecord('salesorder', id);
                var replacedSOid = searchResults[0].getValue('internalid');
                rec.setFieldValue('custbody_yy_so_replacement', replacedSOid);
                nlapiSubmitRecord(rec, true);
                nlapiLogExecution('DEBUG', "nlapiGetFieldValue('tranid') + ' ' + replacedSOid", nlapiGetFieldValue('tranid') + ' ' + replacedSOid);
            }
        }
    }
    catch (e) {
        nlapiLogExecution('ERROR', '@getInternalId', e.message);
    }
}

function addEdgeBandCharges() {

    try {
        // nlapiLogExecution('DEBUG', '@addEdgeBandCharges', 'Running Script');
        var lineCount = nlapiGetLineItemCount('item');
        var edgeBandItems = [];
        var edgeBandLines = [];

        for (var line = 1; line < lineCount + 1; line++) {
            var custcol_yy_mod_edgeband = nlapiGetLineItemValue('item', 'custcol_yy_mod_edgeband', line);
            if (custcol_yy_mod_edgeband) {
                edgeBandLines.push({
                    item: nlapiGetLineItemValue('item', 'item', line),
                    line: line,
                    quantity: nlapiGetLineItemValue('item', 'quantity', line),
                    rate: nlapiGetLineItemValue('item', 'rate', line)
                });
            }
        }
        if (!edgeBandLines.length) { return; }
        var results = nlapiSearchRecord(
            'item',
            null,
            ['internalid', 'anyof', edgeBandLines.map(function(item) { return item.item })],
            [new nlobjSearchColumn('custitem_mb_collection')]
        )
        if (!results || !results.length) { return; }
        var map = {}
        results.forEach(function (result) { 
            map[result.getId()] = result.getValue('custitem_mb_collection')
        })
        edgeBandLines.forEach(function (item) {
            var line = item.line, quantity = item.quantity, rate = item.rate;
            var item = item.item
            nlapiLogExecution('DEBUG', 'map', JSON.stringify(map))
            if (map[item] == '2') {
                nlapiSetLineItemValue('item', 'amount', line, rate * quantity * 1.1);
                nlapiLogExecution('DEBUG', nlapiGetLineItemValue('item', 'amount', line))
            }
        })
    }
    catch (e) {
        nlapiLogExecution('ERROR', '@addEdgeBandCharges', e.message);
    }
}