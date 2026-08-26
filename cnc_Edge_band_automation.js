/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/record', 'N/query', 'N/log'],
    (search, record, query, log) => {

    const CUSTOMER_ID = '161136';
    const MARKUP_ITEM = '306264';
    const EDGE_OPTION_ID = '9097';

    /*
     * SuiteQL item tables.
     * We query only the type actually present on the SO.
     */
    const ITEM_TABLES = {
        Assembly: [
            'assemblyitem',
            'serializedassemblyitem',
            'lotnumberedassemblyitem'
        ],

        InvtPart: [
            'inventoryitem',
            'serializedinventoryitem',
            'lotnumberedinventoryitem'
        ],

        Kit: [
            'kititem'
        ],

        NonInvtPart: [
            'noninventoryitem',
            'noninventorysaleitem',
            'noninventoryresaleitem'
        ],

        Service: [
            'serviceitem',
            'servicesaleitem',
            'serviceresaleitem'
        ],

        OthCharge: [
            'otherchargeitem',
            'otherchargesaleitem',
            'otherchargeresaleitem'
        ]
    };


    // =========================================================
    // GET ITEMS HAVING EDGE BAND OPTION 9097
    // NO ITEM record.load()
    // =========================================================
    const getEdgeItems = (lines) => {

        const byType = {};
        const edgeItems = {};

        lines.forEach(line => {

            if (!ITEM_TABLES[line.itemType]) return;

            if (!byType[line.itemType]) {
                byType[line.itemType] = [];
            }

            if (!byType[line.itemType].includes(Number(line.itemId))) {
                byType[line.itemType].push(Number(line.itemId));
            }
        });


        Object.keys(byType).forEach(type => {

            let remaining = byType[type];

            ITEM_TABLES[type].forEach(table => {

                if (!remaining.length) return;

                const placeholders =
                    remaining.map(() => '?').join(',');

                try {

                    const results = query.runSuiteQL({
                        query: `
                            SELECT id, itemoptions
                            FROM ${table}
                            WHERE id IN (${placeholders})
                        `,
                        params: remaining
                    }).asMappedResults();


                    if (!results.length) return;


                    const found = [];

                    results.forEach(row => {

                        const id = String(row.id);

                        const options = String(
                            row.itemoptions || ''
                        )
                            .split(',')
                            .map(v => v.trim());


                        // EDGE BAND = Item Option Internal ID 9097
                        if (options.includes(EDGE_OPTION_ID)) {
                            edgeItems[id] = true;
                        }

                        found.push(Number(row.id));
                    });


                    // Don't query same items again from another subtype table
                    remaining = remaining.filter(
                        id => !found.includes(id)
                    );

                } catch (e) {
                    // Table may not apply to this subtype - continue
                }
            });
        });


        return edgeItems;
    };


    const afterSubmit = (context) => {

        try {

            // Run on CREATE and EDIT
            if (
                context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT
            ) {
                return;
            }


            const soId = context.newRecord.id;

            const customerId = String(
                context.newRecord.getValue({
                    fieldId: 'entity'
                })
            );


            if (customerId !== CUSTOMER_ID) return;


            // =====================================================
            // SEARCH 1
            // ORIGINAL CLM_EB LINE ONLY
            //
            // IMPORTANT:
            // exclude 306264 so script will not process itself again
            // after saving the SO.
            // =====================================================
            const clmResults = search.create({

                type: search.Type.SALES_ORDER,

                filters: [

                    ['internalid', 'anyof', soId],

                    'AND',
                    ['mainline', 'is', 'F'],

                    'AND',
                    ['taxline', 'is', 'F'],

                    'AND',
                    ['cogs', 'is', 'F'],

                    'AND',
                    ['shipping', 'is', 'F'],

                    'AND',
                    ['custcolproductserviceid_po107', 'is', 'CLM_EB'],

                    'AND',
                    ['item', 'noneof', MARKUP_ITEM]
                ],

                columns: [
                    'item',
                    'line',
                    'lineuniquekey',
                    'custcolassigned_id',
                    'custcolproductserviceid_po107'
                ]

            }).run().getRange({
                start: 0,
                end: 2
            });


            // No original CLM_EB = already processed / nothing to do
            if (!clmResults.length) return;


            // More than one original CLM_EB = do nothing
            if (clmResults.length > 1) {

                log.audit('STOP', {
                    salesOrder: soId,
                    reason: 'More than one original CLM_EB line'
                });

                return;
            }


            const clm = clmResults[0];

            const clmLineKey = String(
                clm.getValue({
                    name: 'lineuniquekey'
                }) || ''
            );

            const clmAssignedId = clm.getValue({
                name: 'custcolassigned_id'
            });

            const clmPo107 = clm.getValue({
                name: 'custcolproductserviceid_po107'
            });


            // =====================================================
            // SEARCH 2
            // GET ALL OTHER SO ITEM LINES
            // =====================================================
            const lines = [];


            search.create({

                type: search.Type.SALES_ORDER,

                filters: [

                    ['internalid', 'anyof', soId],

                    'AND',
                    ['mainline', 'is', 'F'],

                    'AND',
                    ['taxline', 'is', 'F'],

                    'AND',
                    ['cogs', 'is', 'F'],

                    'AND',
                    ['shipping', 'is', 'F']
                ],

                columns: [

                    'item',
                    'line',
                    'lineuniquekey',

                    search.createColumn({
                        name: 'type',
                        join: 'item'
                    })
                ]

            }).run().each(result => {


                const itemId = String(
                    result.getValue({
                        name: 'item'
                    }) || ''
                );


                const lineKey = String(
                    result.getValue({
                        name: 'lineuniquekey'
                    }) || ''
                );


                // Original line being removed
                if (lineKey === clmLineKey) return true;


                // Existing/new markup lines
                if (itemId === MARKUP_ITEM) return true;


                lines.push({

                    itemId,

                    itemType: result.getValue({
                        name: 'type',
                        join: 'item'
                    }),

                    line: result.getValue({
                        name: 'line'
                    }),

                    lineKey
                });


                return true;
            });


            if (!lines.length) return;


            // =====================================================
            // SUITEQL - CHECK ITEM OPTIONS
            // =====================================================
            const edgeItems = getEdgeItems(lines);


            const eligible = lines.filter(
                line => edgeItems[line.itemId] === true
            );


            if (!eligible.length) {

                log.audit('STOP', {
                    salesOrder: soId,
                    reason: 'No Edge Band eligible items'
                });

                return;
            }


            log.audit('PROCESS', {
                salesOrder: soId,
                eligibleLines: eligible.length,
                assignedId: clmAssignedId,
                po107: clmPo107
            });


            // =====================================================
            // ONLY RECORD LOAD IN THE SCRIPT
            // =====================================================
            const so = record.load({
                type: record.Type.SALES_ORDER,
                id: soId,
                isDynamic: false
            });


            // =====================================================
            // ADD 306264 UNDER EACH EDGE BAND ITEM
            // =====================================================
            eligible.forEach(line => {


                const sourceLine =
                    so.findSublistLineWithValue({

                        sublistId: 'item',
                        fieldId: 'lineuniquekey',
                        value: line.lineKey

                    });


                if (sourceLine === -1) return;


                const newLine = sourceLine + 1;


                so.insertLine({
                    sublistId: 'item',
                    line: newLine
                });


                so.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: newLine,
                    value: MARKUP_ITEM
                });


                // PO107 FROM ORIGINAL REMOVED LINE
                if (clmPo107) {

                    so.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolproductserviceid_po107',
                        line: newLine,
                        value: clmPo107
                    });
                }


                // ASSIGNED ID FROM ORIGINAL REMOVED LINE
                if (clmAssignedId) {

                    so.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolassigned_id',
                        line: newLine,
                        value: clmAssignedId
                    });
                }

            });


            // =====================================================
            // REMOVE ORIGINAL CLM_EB LINE
            // =====================================================
            const clmPosition =
                so.findSublistLineWithValue({

                    sublistId: 'item',
                    fieldId: 'lineuniquekey',
                    value: clmLineKey

                });


            if (clmPosition === -1) {
                throw Error('Original CLM_EB line not found');
            }


            so.removeLine({
                sublistId: 'item',
                line: clmPosition
            });


            // =====================================================
            // SAVE ONCE
            // =====================================================
            so.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });


            log.audit('SUCCESS', {
                salesOrder: soId,
                markupLinesAdded: eligible.length,
                assignedId: clmAssignedId,
                po107: clmPo107
            });


        } catch (e) {

            log.error('EDGE BAND ERROR', {
                salesOrder: context.newRecord.id,
                name: e.name,
                message: e.message
            });
        }
    };


    return {
        afterSubmit
    };

});