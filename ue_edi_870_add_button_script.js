/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * EDI 870 - User Event Script
 *
 * Adds action buttons to the Sales Order based on:
 *   - EDI Status Validator
 *   - Native Sales Order status
 *
 * IMPORTANT:
 * When EDI Status Validator = Order Cancel Request (Internal ID 16),
 * show:
 *   - Confirm Cancel
 *   - Deny Cancel
 */

define([
    'N/record',
    'N/runtime',
    'N/ui/serverWidget',
    'N/search',
    'N/log',
    'N/format'
], function (
    record,
    runtime,
    serverWidget,
    search,
    log,
    format
) {

    // ============================================================
    // CONFIGURATION
    // ============================================================

    const CONFIG = {

        EDI_STATUS_FIELD: 'custbody_boomi_edi_status_validator',

        STATUS: {
            READY:              '1',
            TRANSFERRED:        '2',
            ERROR:              '3',
            ORDER_RECEIVED:     '5',
            ORDER_APPROVED:     '6',
            EDI_855_SENT:       '7',
            EDI_856_SENT:       '8',
            EDI_810_SENT:       '9',
            CLOSED:             '10',
            EDI_REJECTED:       '11',
            EDI_870_SENT_AP:    '12',
            EDI_COST_PENDING:   '13',
            EDI_COST_CONFIRMED: '14',
            EDI_RCVD_ACTION:    '15',

            // Order Cancel Request
            EDI_CANCEL_REQUEST: '16',

            // Confirmed Cancel
            EDI_CONFIRM_CANCEL: '17'
        },

        // Flag indicating an 850 cancellation was received
        CANCEL_RECEIVED_FIELD: 'custbody_edi_850_cancel_rcvd'
    };


    // ============================================================
    // LEAD TIME CONFIGURATION
    // ============================================================

    const LEAD_TIME_DAYS_BY_ID = {
        1:  5,   // 2 DART
        3:  5,   // 3 DART
        4:  15,  // 10 Concord
        7:  15,  // 10 Classic
        5:  20,  // 12 Concord
        6:  20,  // 12 Classic
        15: 20   // 12 Stain
    };


    let HOME_DEPOT_CUSTOMER_ID = '161136';

    let LEAD_TIME_DAYS_BY_NAME = {};


    // ============================================================
    // BEFORE LOAD
    // ============================================================

    function beforeLoad(context) {

        try {

            // --------------------------------------------------------
            // Only run in VIEW or EDIT
            // --------------------------------------------------------

            if (
                context.type !== context.UserEventType.VIEW &&
                context.type !== context.UserEventType.EDIT
            ) {
                return;
            }


            // --------------------------------------------------------
            // Only run from NetSuite UI
            // --------------------------------------------------------

            if (
                runtime.executionContext !==
                runtime.ContextType.USER_INTERFACE
            ) {
                return;
            }


            const currentRecord = context.newRecord;
            const form = context.form;


            // --------------------------------------------------------
            // HOME DEPOT ONLY
            // --------------------------------------------------------

            const customerId = String(
                currentRecord.getValue({
                    fieldId: 'entity'
                })
            );


            if (customerId !== HOME_DEPOT_CUSTOMER_ID) {

                log.debug({
                    title: 'EDI 870 beforeLoad',
                    details:
                        'Skipping buttons because customer is not Home Depot. ' +
                        'Customer ID: ' + customerId
                });

                return;
            }


            // --------------------------------------------------------
            // GET EDI STATUS
            // --------------------------------------------------------

            const ediStatus = String(
                currentRecord.getValue({
                    fieldId: CONFIG.EDI_STATUS_FIELD
                }) || ''
            );


            // --------------------------------------------------------
            // GET SALES ORDER STATUS
            // --------------------------------------------------------

            const soStatus = currentRecord.getValue({
                fieldId: 'status'
            });


            // --------------------------------------------------------
            // GET CANCEL RECEIVED FLAG
            // --------------------------------------------------------

            const cancelReceived = currentRecord.getValue({
                fieldId: CONFIG.CANCEL_RECEIVED_FIELD
            });


            log.debug({
                title: 'EDI 870 Button Check',
                details: JSON.stringify({
                    customerId: customerId,
                    ediStatus: ediStatus,
                    soStatus: soStatus,
                    cancelReceived: cancelReceived
                })
            });


            // ========================================================
            // ORDER CANCEL REQUEST
            // ========================================================
            //
            // IMPORTANT:
            //
            // EDI Status Validator = 16
            // Order Cancel Request
            //
            // SHOW:
            //   - Confirm Cancel
            //   - Deny Cancel
            //
            // This is intentionally BEFORE the Sales Order status
            // restriction below.
            //
            // ========================================================

            if (
                ediStatus ===
                CONFIG.STATUS.EDI_CANCEL_REQUEST
            ) {

                // ----------------------------------------------------
                // CONFIRM CANCEL
                // ----------------------------------------------------

                form.addButton({
                    id: 'custpage_btn_confirm_cancel',
                    label: 'Confirm Cancel',
                    functionName: 'edi870_confirmCancel'
                });


                // ----------------------------------------------------
                // DENY CANCEL
                // ----------------------------------------------------

                form.addButton({
                    id: 'custpage_btn_deny_cancel',
                    label: 'Deny Cancel',
                    functionName: 'edi870_denyCancel'
                });


                // ----------------------------------------------------
                // CLIENT SCRIPT
                // ----------------------------------------------------

                form.clientScriptModulePath =
                    '/SuiteScripts/cs_edi_870_update_status_script.js';


                log.audit({
                    title: 'EDI Cancel Request Buttons',
                    details:
                        'EDI Status = Order Cancel Request (16). ' +
                        'Showing Confirm Cancel and Deny Cancel.'
                });


                // IMPORTANT:
                // Stop here so no other EDI 870 buttons are added.
                return;
            }


            // ========================================================
            // SALES ORDER STATUS RESTRICTIONS
            // ========================================================

            const noButtonStatuses = [
                'pendingBilling',
                'fullyBilled',
                'closed'
            ];


            if (
                noButtonStatuses.indexOf(soStatus) !== -1
            ) {

                // ----------------------------------------------------
                // Exception:
                // Received Action Needed can still update ETA
                // ----------------------------------------------------

                if (
                    ediStatus ===
                    CONFIG.STATUS.EDI_RCVD_ACTION
                ) {

                    form.addButton({
                        id: 'custpage_btn_reschedule',
                        label: 'Update ETA / Respond',
                        functionName: 'edi870_reschedule'
                    });


                    form.clientScriptModulePath =
                        '/SuiteScripts/cs_edi_870_update_status_script.js';
                }


                return;
            }


            // ========================================================
            // ORDER RECEIVED
            // ========================================================
            //
            // Show:
            //   Cost Discrepancy
            //   Reject Order
            //   Address Correction
            //   Reschedule Delivery
            //
            // ========================================================

            if (
                ediStatus ===
                CONFIG.STATUS.ORDER_RECEIVED
            ) {

                form.addButton({
                    id: 'custpage_btn_cost_discrepancy',
                    label: 'Cost Discrepancy',
                    functionName: 'edi870_costDiscrepancy'
                });


                form.addButton({
                    id: 'custpage_btn_reject_order',
                    label: 'Reject Order',
                    functionName: 'edi870_rejectOrder'
                });


                form.addButton({
                    id: 'custpage_btn_address_correction',
                    label: 'Address Correction',
                    functionName: 'edi870_addressCorrection'
                });


                form.addButton({
                    id: 'custpage_btn_reschedule',
                    label: 'Reschedule Delivery',
                    functionName: 'edi870_reschedule'
                });
            }


            // ========================================================
            // ORDER APPROVED
            // ========================================================

            if (
                ediStatus ===
                CONFIG.STATUS.ORDER_APPROVED
            ) {

                form.addButton({
                    id: 'custpage_btn_reschedule',
                    label: 'Reschedule Delivery',
                    functionName: 'edi870_reschedule'
                });
            }


            // ========================================================
            // 870 AP SENT
            // ========================================================
            //
            // If cancellation was received after production:
            // Show Deny Cancel
            //
            // ========================================================

            if (
                ediStatus === CONFIG.STATUS.EDI_870_SENT_AP &&
                cancelReceived
            ) {

                form.addButton({
                    id: 'custpage_btn_deny_cancel',
                    label: 'Deny Cancel',
                    functionName: 'edi870_denyCancel'
                });
            }


            // ========================================================
            // COST CONFIRMED
            // ========================================================

            if (
                ediStatus ===
                CONFIG.STATUS.EDI_COST_CONFIRMED
            ) {

                form.addButton({
                    id: 'custpage_btn_reschedule',
                    label: 'Reschedule Delivery',
                    functionName: 'edi870_reschedule'
                });
            }


            // ========================================================
            // RECEIVED ACTION NEEDED
            // ========================================================

            if (
                ediStatus ===
                CONFIG.STATUS.EDI_RCVD_ACTION
            ) {

                form.addButton({
                    id: 'custpage_btn_reschedule',
                    label: 'Update ETA / Respond',
                    functionName: 'edi870_reschedule'
                });
            }


            // ========================================================
            // CLIENT SCRIPT
            // ========================================================

            form.clientScriptModulePath =
                '/SuiteScripts/cs_edi_870_update_status_script.js';


        } catch (e) {

            log.error({
                title: 'beforeLoad Error',
                details:
                    e.name + ': ' +
                    e.message
            });
        }
    }


    // ============================================================
    // BEFORE SUBMIT
    // ============================================================

    const beforeSubmit = (context) => {

        try {

            const EDIT_MODES = [
                context.UserEventType.CREATE,
                context.UserEventType.EDIT,
                context.UserEventType.XEDIT
            ];


            if (!EDIT_MODES.includes(context.type)) {
                return;
            }


            const rec = context.newRecord;


            // --------------------------------------------------------
            // HOME DEPOT ONLY
            // --------------------------------------------------------

            const customerId = String(
                rec.getValue({
                    fieldId: 'entity'
                })
            );


            if (customerId !== HOME_DEPOT_CUSTOMER_ID) {

                log.debug(
                    'beforeSubmit',
                    'SO ' + rec.id +
                    ': skipped — customer ' +
                    customerId +
                    ' is not Home Depot'
                );

                return;
            }


            // --------------------------------------------------------
            // PENDING FULFILLMENT ONLY
            // --------------------------------------------------------

            const status = rec.getValue({
                fieldId: 'statusRef'
            });


            if (status !== 'pendingFulfillment') {
                return;
            }


            const lineCount = rec.getLineCount({
                sublistId: 'item'
            });


            if (lineCount <= 0) {
                return;
            }


            let earliestDate = null;


            // --------------------------------------------------------
            // FIND EARLIEST PRODUCTION DATE
            // --------------------------------------------------------

            for (let i = 0; i < lineCount; i++) {

                const lineDate =
                    rec.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_yy_so_proddate',
                        line: i
                    });


                if (!lineDate) {
                    continue;
                }


                const parsedDate =
                    lineDate instanceof Date
                        ? lineDate
                        : new Date(lineDate);


                if (
                    isNaN(
                        parsedDate.getTime()
                    )
                ) {
                    continue;
                }


                if (
                    earliestDate === null ||
                    parsedDate < earliestDate
                ) {
                    earliestDate = parsedDate;
                }
            }


            // --------------------------------------------------------
            // STORE EARLIEST PRODUCTION DATE
            // --------------------------------------------------------

            if (earliestDate !== null) {

                log.debug({
                    title: 'Earliest Production Date Found',
                    details: earliestDate.toISOString()
                });


                rec.setValue({
                    fieldId:
                        'custbody_boomi_edi_production_date_cal',
                    value: earliestDate
                });

            } else {

                log.debug({
                    title: 'No Production Dates Found',
                    details:
                        'All lines have empty ' +
                        'custcol_yy_so_proddate'
                });
            }


        } catch (e) {

            log.error({
                title: 'beforeSubmit Error',
                details: e.message
            });
        }
    };


    // ============================================================
    // AFTER SUBMIT
    // ============================================================

    const afterSubmit = (context) => {

        // Only run on CREATE
        if (
            context.type !==
            context.UserEventType.CREATE
        ) {
            return;
        }


        try {

            // --------------------------------------------------------
            // BUILD LEAD TIME MAP
            // --------------------------------------------------------

            buildLeadTimeNameMap();


            // --------------------------------------------------------
            // LOAD SALES ORDER
            // --------------------------------------------------------

            const soRecord = record.load({
                type: record.Type.SALES_ORDER,
                id: context.newRecord.id,
                isDynamic: true
            });


            // --------------------------------------------------------
            // HOME DEPOT ONLY
            // --------------------------------------------------------

            const customerId = String(
                soRecord.getValue({
                    fieldId: 'entity'
                })
            );


            if (
                customerId !==
                HOME_DEPOT_CUSTOMER_ID
            ) {

                log.debug(
                    'afterSubmit',
                    'SO ' +
                    context.newRecord.id +
                    ': skipped — customer ' +
                    customerId +
                    ' is not Home Depot'
                );

                return;
            }


            // --------------------------------------------------------
            // PENDING APPROVAL ONLY
            // --------------------------------------------------------

            const status =
                soRecord.getValue({
                    fieldId: 'statusRef'
                });


            log.audit(
                'SO Status',
                status
            );


            if (
                status !==
                'pendingApproval'
            ) {

                log.debug(
                    'afterSubmit',
                    'SO ' +
                    context.newRecord.id +
                    ': skipped — status "' +
                    status +
                    '" not Pending Approval'
                );

                return;
            }


            const lineCount =
                soRecord.getLineCount({
                    sublistId: 'item'
                });


            if (lineCount === 0) {
                return;
            }


            // ========================================================
            // STEP 1
            // FIND LONGEST LEAD TIME
            // ========================================================

            const lineDaysMap = {};

            let maxDays = 0;


            for (
                let i = 0;
                i < lineCount;
                i++
            ) {

                const itemId =
                    soRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: i
                    });


                if (!itemId) {
                    continue;
                }


                // ----------------------------------------------------
                // LOOK UP ITEM LEAD TIME
                // ----------------------------------------------------

                const ltLookup =
                    search.lookupFields({
                        type: search.Type.ITEM,
                        id: itemId,
                        columns: [
                            'custitem_ah_item_lt'
                        ]
                    });


                const ltField =
                    ltLookup.custitem_ah_item_lt;


                if (
                    !ltField ||
                    !ltField[0]
                ) {

                    log.debug(
                        'afterSubmit',
                        'Line ' +
                        i +
                        ' Item ' +
                        itemId +
                        ': no lead time record linked'
                    );

                    continue;
                }


                const ltId =
                    ltField[0].value;

                const ltName =
                    ltField[0].text;


                const days =
                    resolveDays(
                        ltId,
                        ltName
                    );


                if (days === null) {
                    continue;
                }


                lineDaysMap[i] = days;


                if (
                    days > maxDays
                ) {
                    maxDays = days;
                }


                log.debug(
                    'afterSubmit',
                    'Line ' +
                    i +
                    ' Item ' +
                    itemId +
                    ' → LT ID:' +
                    ltId +
                    ' Name:"' +
                    ltName +
                    '" → ' +
                    days +
                    ' days'
                );
            }


            if (maxDays === 0) {

                log.audit(
                    'afterSubmit',
                    'SO ' +
                    context.newRecord.id +
                    ': no lead time matches found, ' +
                    'shipdate not updated'
                );

                return;
            }


            // ========================================================
            // STEP 2
            // DETERMINE DAY ONE
            // ========================================================

            const now = new Date();

            // Existing logic from original script:
            // UTC - 5
            const estOffset = 5 * 60;

            const utcMinutes =
                now.getUTCHours() * 60 +
                now.getUTCMinutes();

            const estMinutes =
                utcMinutes -
                estOffset;

            const estHour =
                Math.floor(
                    (
                        (
                            estMinutes %
                            1440
                        ) +
                        1440
                    ) %
                    1440 /
                    60
                );


            log.audit(
                'afterSubmit',
                'SO ' +
                context.newRecord.id +
                ': Current EST hour = ' +
                estHour
            );


            // --------------------------------------------------------
            // TRANSACTION DATE
            // --------------------------------------------------------

            const tranDateRaw =
                soRecord.getValue({
                    fieldId: 'trandate'
                });


            const tranDate =
                format.parse({
                    value: tranDateRaw,
                    type: format.Type.DATE
                });


            tranDate.setHours(
                12,
                0,
                0,
                0
            );


            let dayOne;


            if (estHour >= 17) {

                dayOne =
                    addBusinessDays(
                        tranDate,
                        1
                    );


                log.audit(
                    'afterSubmit',
                    'SO ' +
                    context.newRecord.id +
                    ': At/after 5PM EST — Day One = ' +
                    dayOne.toDateString()
                );

            } else {

                dayOne = tranDate;


                log.audit(
                    'afterSubmit',
                    'SO ' +
                    context.newRecord.id +
                    ': Before 5PM EST — Day One = ' +
                    dayOne.toDateString()
                );
            }


            // ========================================================
            // STEP 3
            // SHIP DUE DATE
            // ========================================================

            const shipDueDate =
                addBusinessDays(
                    dayOne,
                    maxDays
                );


            log.audit(
                'afterSubmit',
                'SO ' +
                context.newRecord.id +
                ': Ship Due Date = ' +
                shipDueDate.toDateString() +
                ' (Day One + ' +
                maxDays +
                ' business days)'
            );


            // ========================================================
            // STEP 4
            // ESTIMATED DELIVERY DATE
            // ========================================================

            let estimatedDeliveryDate =
                addBusinessDays(
                    shipDueDate,
                    7
                );


            log.audit(
                'afterSubmit',
                'SO ' +
                context.newRecord.id +
                ': Estimated Delivery Date = ' +
                estimatedDeliveryDate.toDateString()
            );


            // ========================================================
            // STEP 5
            // HD REQUESTED DELIVERY DATE
            // ========================================================

            const hdRequestedDeliveryRaw =
                soRecord.getValue({
                    fieldId:
                        'custbody_boomi_hd_req_delivery_date'
                });


            let finalShipDate =
                shipDueDate;


            if (
                hdRequestedDeliveryRaw
            ) {

                const hdRequestedDeliveryDate =
                    hdRequestedDeliveryRaw
                        instanceof Date

                        ? hdRequestedDeliveryRaw

                        : format.parse({
                            value:
                                hdRequestedDeliveryRaw,
                            type:
                                format.Type.DATE
                        });


                hdRequestedDeliveryDate
                    .setHours(
                        12,
                        0,
                        0,
                        0
                    );


                log.audit(
                    'afterSubmit',
                    'SO ' +
                    context.newRecord.id +
                    ': HD Requested Delivery Date = ' +
                    hdRequestedDeliveryDate
                        .toDateString()
                );


                estimatedDeliveryDate
                    .setHours(
                        12,
                        0,
                        0,
                        0
                    );


                // ====================================================
                // STEP 6
                // COMPARE DATES
                // ====================================================

                if (
                    hdRequestedDeliveryDate >
                    estimatedDeliveryDate
                ) {

                    finalShipDate =
                        subtractBusinessDays(
                            hdRequestedDeliveryDate,
                            7
                        );


                    estimatedDeliveryDate =
                        hdRequestedDeliveryDate;


                    finalShipDate.setHours(
                        12,
                        0,
                        0,
                        0
                    );


                    log.audit(
                        'afterSubmit',
                        'SO ' +
                        context.newRecord.id +
                        ': HD date ' +
                        hdRequestedDeliveryDate
                            .toDateString() +
                        ' is later — revised Ship Date = ' +
                        finalShipDate
                            .toDateString()
                    );

                } else {

                    log.audit(
                        'afterSubmit',
                        'SO ' +
                        context.newRecord.id +
                        ': HD date ' +
                        hdRequestedDeliveryDate
                            .toDateString() +
                        ' <= estimated ' +
                        estimatedDeliveryDate
                            .toDateString() +
                        ' — using VTT-calculated dates'
                    );
                }

            } else {

                log.audit(
                    'afterSubmit',
                    'SO ' +
                    context.newRecord.id +
                    ': no HD Requested Delivery Date — ' +
                    'using VTT-calculated dates only'
                );
            }


            // ========================================================
            // STEP 7
            // VALIDATE DATES
            // ========================================================

            if (
                isNaN(
                    finalShipDate.getTime()
                )
            ) {

                log.error(
                    'afterSubmit',
                    'SO ' +
                    context.newRecord.id +
                    ': finalShipDate is invalid — aborting'
                );

                return;
            }


            if (
                isNaN(
                    estimatedDeliveryDate.getTime()
                )
            ) {

                log.error(
                    'afterSubmit',
                    'SO ' +
                    context.newRecord.id +
                    ': estimatedDeliveryDate is invalid — aborting'
                );

                return;
            }


            finalShipDate.setHours(
                12,
                0,
                0,
                0
            );


            estimatedDeliveryDate.setHours(
                12,
                0,
                0,
                0
            );


            // ========================================================
            // STEP 8
            // UPDATE HEADER SHIP DATE
            // ========================================================

            soRecord.setValue({
                fieldId: 'shipdate',
                value: finalShipDate
            });


            // ========================================================
            // STEP 9
            // UPDATE ESTIMATED DELIVERY DATE
            // ========================================================

            soRecord.setValue({
                fieldId:
                    'custbody_boomi_estimated_delivery_date',
                value:
                    estimatedDeliveryDate
            });


            // --------------------------------------------------------
            // SAVE SALES ORDER
            // --------------------------------------------------------

            soRecord.save({
                ignoreMandatoryFields: true
            });


            log.audit(
                'afterSubmit',
                'SO ' +
                context.newRecord.id +
                ': header shipdate = ' +
                finalShipDate.toDateString() +
                ' | estimated delivery = ' +
                estimatedDeliveryDate.toDateString()
            );


        } catch (e) {

            log.error(
                'afterSubmit',
                'SO ' +
                context.newRecord.id +
                ': ' +
                e.message
            );
        }
    };


    // ============================================================
    // ADD BUSINESS DAYS
    // ============================================================

    const addBusinessDays = (
        startDate,
        days
    ) => {

        let date =
            new Date(startDate);

        let added = 0;


        while (
            added < days
        ) {

            date.setDate(
                date.getDate() + 1
            );


            const dow =
                date.getDay();


            // 0 = Sunday
            // 6 = Saturday
            if (
                dow !== 0 &&
                dow !== 6
            ) {
                added++;
            }
        }


        return date;
    };


    // ============================================================
    // SUBTRACT BUSINESS DAYS
    // ============================================================

    const subtractBusinessDays = (
        startDate,
        days
    ) => {

        let date =
            new Date(startDate);

        let subtracted = 0;


        while (
            subtracted < days
        ) {

            date.setDate(
                date.getDate() - 1
            );


            const dow =
                date.getDay();


            if (
                dow !== 0 &&
                dow !== 6
            ) {
                subtracted++;
            }
        }


        return date;
    };


    // ============================================================
    // BUILD LEAD TIME NAME MAP
    // ============================================================

    const buildLeadTimeNameMap = () => {

        LEAD_TIME_DAYS_BY_NAME = {};


        search.create({

            type:
                'customrecord_ah_lead_time',

            filters: [
                [
                    'isinactive',
                    'is',
                    false
                ]
            ],

            columns: [

                search.createColumn({
                    name: 'internalid'
                }),

                search.createColumn({
                    name: 'name'
                })

            ]

        }).run().each(
            result => {

                const id =
                    parseInt(
                        result.getValue({
                            name: 'internalid'
                        }),
                        10
                    );


                const name =
                    (
                        result.getValue({
                            name: 'name'
                        }) || ''
                    )
                        .toUpperCase()
                        .trim();


                const days =
                    LEAD_TIME_DAYS_BY_ID[id] ??
                    null;


                if (
                    name &&
                    days !== null
                ) {

                    LEAD_TIME_DAYS_BY_NAME[
                        name
                    ] = {
                        id: id,
                        days: days
                    };
                }


                return true;
            }
        );


        log.debug(
            'buildLeadTimeNameMap',
            JSON.stringify(
                LEAD_TIME_DAYS_BY_NAME
            )
        );
    };


    // ============================================================
    // RESOLVE LEAD TIME DAYS
    // ============================================================

    const resolveDays = (
        ltId,
        ltName
    ) => {

        const nameKey =
            (
                ltName || ''
            )
                .toUpperCase()
                .trim();


        // --------------------------------------------------------
        // 1. MATCH BY NAME
        // --------------------------------------------------------

        if (
            nameKey &&
            LEAD_TIME_DAYS_BY_NAME[
                nameKey
            ] !== undefined
        ) {

            log.debug(
                'resolveDays',
                'Matched by NAME "' +
                nameKey +
                '" → ' +
                LEAD_TIME_DAYS_BY_NAME[
                    nameKey
                ].days +
                ' days'
            );


            return (
                LEAD_TIME_DAYS_BY_NAME[
                    nameKey
                ].days
            );
        }


        // --------------------------------------------------------
        // 2. MATCH BY INTERNAL ID
        // --------------------------------------------------------

        const idKey =
            parseInt(
                ltId,
                10
            );


        if (
            LEAD_TIME_DAYS_BY_ID[
                idKey
            ] !== undefined
        ) {

            log.debug(
                'resolveDays',
                'Matched by ID ' +
                idKey +
                ' → ' +
                LEAD_TIME_DAYS_BY_ID[
                    idKey
                ] +
                ' days'
            );


            return (
                LEAD_TIME_DAYS_BY_ID[
                    idKey
                ]
            );
        }


        log.debug(
            'resolveDays',
            'No match for ID:' +
            ltId +
            ' Name:"' +
            ltName +
            '"'
        );


        return null;
    };


    // ============================================================
    // ADD CALENDAR DAYS
    // Retained from original script
    // ============================================================

    const addCalendarDays = (
        startDate,
        days
    ) => {

        let date =
            new Date(startDate);


        date.setDate(
            date.getDate() +
            days
        );


        return date;
    };


    // ============================================================
    // SCRIPT ENTRY POINTS
    // ============================================================

    return {

        beforeLoad:
            beforeLoad,

        beforeSubmit:
            beforeSubmit,

        afterSubmit:
            afterSubmit

    };

});