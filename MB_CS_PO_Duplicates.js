function clientFieldChanged(type, name, linenum) {
    if (name == "otherrefnum") {
        nlapiSetFieldValue("custbody_mb_duplicate_po", "F");
    }
    // when contact is changed set order email addy.
    if (name == "custbody_mb_contact") {
        var contactId = nlapiGetFieldValue("custbody_mb_contact");
        if (contactId != null && contactId != "") {

            // Email Print Fax USPS
            var docPref = nlapiLookupField("contact", contactId, "custentity_mb_delivery_pref", true);
            nlapiSetFieldText("custbody_mb_document_pref", docPref);
            if (docPref == "Email") {
                var contactEmail = nlapiLookupField("contact", contactId, "email");
                if (contactEmail) {
                    nlapiSetFieldValue("email", contactEmail, false);
                    nlapiGetFieldValue("fax") && nlapiSetFieldValue("fax", "", false);
                }
            }
            
            if (docPref == "Fax") {
                var contactFax = nlapiLookupField("contact", contactId, "fax");
                if (contactFax) {
                    nlapiSetFieldValue("fax", contactFax, false);
                    nlapiGetFieldValue("email") && nlapiSetFieldValue("email", "", false);
                }
            }
        }
        else if (nlapiGetFieldValue("custbody_mb_document_pref")) {
            nlapiSetFieldValue("custbody_mb_document_pref", "", true, true);
        }
    }
    if (name == 'entity') {
        var docTypes = { estimate: 1, salesorder: 2 }
        var docType = docTypes[nlapiGetRecordType()]
        var entity = nlapiGetFieldValue('entity')

        if (!entity || !docType) return

        var contactSearch = nlapiSearchRecord("contact", null,
            [
                ["customer.internalid", "anyof", entity], "AND",
                ["custentity_mb_doctypes", "anyof", docType], "AND",
                ["custentity_mb_delivery_pref", "anyof", "1"]
            ], [new nlobjSearchColumn("email")])

        if (contactSearch) {
            nlapiSetFieldValue('custbody_mb_contact', contactSearch[0].id, false)
            nlapiSetFieldValue('email', contactSearch[0].getValue('email'), false)
        }
    }
}


function clientSaveRecord() {
    if (nlapiGetUser() == '156044') { return true; }
    // skip if the override flag was tripped
    if (nlapiGetFieldValue("custbody_mb_duplicate_po") != "T") {
        // true if the PO is on file
        if (poExists()) {

            // // ask the user if they want to override or cancel
            // if (confirm("This PO is a duplicate! Press OK to override or Cancel to change it. ")) {
            //     nlapiSetFieldValue("custbody_mb_duplicate_po", "T");
            //     return true;
            // }
            // // cancel – return false and cancel save
            // else {
            //     return false;
            // }

            // Force user to cancel/update PO - YY
            // 
            alert("This PO is a duplicate! Please change it. ");
            // cancel – return false and cancel save
            return false;
        }
    }
    return true;
}


//return true if a PO exists for this customer and is not null or empty

function poExists(recSalesOrder) {
    try {

        var duration = new Date().getTime();
        var entityName = nlapiGetRecordType();
        var customerPO = nlapiGetFieldValue("otherrefnum");
        var customer = nlapiGetFieldValue("entity");
        var tranId = nlapiGetFieldValue("tranid");

        if (!customer || !customerPO) return false;
        
        var json;
        try { json = JSON.parse(nlapiGetFieldValue('custbody_nk_json')) } catch (e) { json = {} };
        if (json.reserved_po_num == customerPO) {
            console.log('poExists() ' + (new Date().getTime() - duration) + 'ms;')
            return false;
        }
        
        nlapiLogExecution("debug", "Customer PO ", customerPO);
        nlapiLogExecution("debug", "Customer ", customer);

        var filters = [new nlobjSearchFilter("name", null, "anyof", customer),
        new nlobjSearchFilter("mainline", null, "is", "T"),
        new nlobjSearchFilter("otherrefnum", null, "equalto", customerPO)
        ];
        // add the transaction id filter when its not a new SO
        if (tranId != "To Be Generated") {
            filters.push(new nlobjSearchFilter("tranid", null, "isnot", tranId));
        }
        var searchResult = nlapiSearchRecord(entityName, null, filters);

        console.log('poExists() ' + (new Date().getTime() - duration) + 'ms;')
        /// if there was a search result then there is a duplicate PO
        if (searchResult) {
            return (true);
        }
        json.reserved_po_num = customerPO;
        nlapiSetFieldValue('custbody_nk_json', JSON.stringify(json))
        return false;
    } catch (e) {
        // error handler removed for brevity
        alert("Exception is " + e);
    }
}