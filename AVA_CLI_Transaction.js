/******************************************************************************************************
	Script Name - AVA_CLI_Transaction.js
	Company -     Avalara Technologies Pvt Ltd.
******************************************************************************************************/

/**
 *@NApiVersion 2.0
 *@NScriptType ClientScript
*/

define(['N/currentRecord', 'N/search', './utility/AVA_TaxLibrary', './utility/AVA_Library', 'N/runtime'],
	function(currentRecord, search, taxLibrary, ava_library, runtime){
		function AVA_TransactionInit(context){
			taxLibrary.AVA_TransactionPageInitEvent(context);
		}
		
		function AVA_TransactionFieldChanged(context){
			taxLibrary.AVA_TransactionFieldChangedEvent(context);
		}
		
		function AVA_TransactionPostSourcing(context){
			try{
				var cRecord = context.currentRecord;
				
				if(cRecord.getValue('custpage_ava_context') == 'WEBSTORE'){
					var configCache = JSON.parse(cRecord.getValue('custpage_ava_configobj'));
					
					if(configCache.AVA_ServiceTypes != null && configCache.AVA_ServiceTypes.search('TaxSvc') != -1){
						if(context.fieldId == 'couponcode' || (context.fieldId == 'shipmethod' && cRecord.getValue('shipmethod') != null && cRecord.getValue('shipmethod').length > 0)){ // Recalculate tax if coupon code is applied or shipping method is changed.
							taxLibrary.AVA_CalculateTaxOnDemand(cRecord, new Date());
						}
					}
				}
			}
			catch(err){
				log.debug({
					title: 'AVA_TransactionPostSourcing - Error',
					details: err.message
				});
			}
		}
		
		function AVA_TransactionSublistChanged(context){
			var featureInEffect = runtime.isFeatureInEffect({feature: 'SUITECOMMERCE_ADVANCED'});
			
			if(runtime.executionContext == runtime.ContextType.WEBSTORE && featureInEffect == true){
				var suppressTaxCalculation = runtime.getCurrentSession().get({ name: 'suppressTaxCalculation'});
				
				if(suppressTaxCalculation == true || suppressTaxCalculation == 'true'){
					log.debug("TaxSuppressed", true);
				}
				else{
					taxLibrary.AVA_TransactionSublistChangedEvent(context);
				}
			}
			else{
				taxLibrary.AVA_TransactionSublistChangedEvent(context);
			}
		}
		
		function AVA_TransactionValidateLine(context){
			try{
				var cRecord = context.currentRecord;
				
				if(cRecord.getValue('custpage_ava_context') == 'USERINTERFACE' && context.sublistId == 'item' && cRecord.getValue('nexus_country') == 'IN' && cRecord.getValue('ismultishipto') == true){
					if(cRecord.getValue('custpage_ava_configobj') != null && cRecord.getValue('custpage_ava_configobj').length > 0){
						var prevLineGSTIN, prevLineShipAddress;
						var configCache = JSON.parse(cRecord.getValue('custpage_ava_configobj'));
						
						if(configCache.AVA_ServiceTypes != null && configCache.AVA_ServiceTypes.search('TaxSvc') != -1){
							var currentLineNum = cRecord.getCurrentSublistIndex(context.sublistId);
							if(currentLineNum > 0){
								prevLineShipAddress = cRecord.getSublistValue(context.sublistId, 'shipaddress', currentLineNum - 1);
								prevLineGSTIN = cRecord.getSublistValue(context.sublistId, 'custcol_ava_customergstin', currentLineNum - 1);
							}
							
							if(cRecord.getCurrentSublistValue(context.sublistId, 'shipaddress') == prevLineShipAddress && currentLineNum > 0){
								cRecord.setCurrentSublistValue({
									sublistId: context.sublistId,
									fieldId: 'custcol_ava_customergstin',
									value: prevLineGSTIN
								});
							}
							else{
								var searchRecord = search.create({
									type: 'customer',
									filters:
										[
											['internalid', 'anyof', cRecord.getValue('entity')],
											'and',
											['formulanumeric: {address.addressinternalid}', 'equalto', cRecord.getCurrentSublistValue(context.sublistId, 'shipaddress')]
										],
									columns:
										[
											search.createColumn({
												name: 'custrecord_ava_customergstin',
												join: 'Address'
											})
										]
								});
								var customerSearchResult = searchRecord.run();
								customerSearchResult = customerSearchResult.getRange({
									start: 0,
									end: 5
								});
								
								if(customerSearchResult != null && customerSearchResult.length > 0){
									var custGSTIN = customerSearchResult[0].getValue({
										name: 'custrecord_ava_customergstin',
										join: 'Address'
									});
									
									if(cRecord.getCurrentSublistValue(context.sublistId, 'custcol_ava_customergstin') != custGSTIN){
										cRecord.setCurrentSublistValue({
											sublistId: context.sublistId,
											fieldId: 'custcol_ava_customergstin',
											value: custGSTIN
										});
									}
								}
							}
						}
					}
				}
				
				if(cRecord.getValue('custpage_ava_context') == 'USERINTERFACE' && context.sublistId == 'item'){
					var itemType = cRecord.getCurrentSublistValue({
						sublistId: context.sublistId,
						fieldId: 'itemtype'
					});
					
					if(itemType != 'Markup' && itemType != 'Description' && itemType != 'Subtotal' && itemType != 'Group' && itemType != 'EndGroup'){
						var multiTaxType = cRecord.getCurrentSublistValue({
							sublistId: context.sublistId,
							fieldId: 'custpage_ava_multitaxtypes'
						});
						
						if(multiTaxType != 0){
							cRecord.setCurrentSublistValue({
								sublistId: context.sublistId,
								fieldId: 'custcol_ava_multitaxtypes',
								value: multiTaxType
							});
						}
						else{
							cRecord.setCurrentSublistValue({
								sublistId: context.sublistId,
								fieldId: 'custcol_ava_multitaxtypes',
								value: ''
							});
						}
					}
				}
			}
			catch(err){
				log.debug({
					title: 'AVA_TransactionValidateLine - Error',
					details: err.message
				});
			}
			
			return true;
		}
		
		function AVA_TransactionSave(context){
			var cRecord = context.currentRecord;
			if(cRecord.getValue('custbody_ava_disable_tax_calculation') == true){
				return true;
			}
			
			return taxLibrary.AVA_TransactionSaveEvent(context);
		}
		
		function AVA_CalculateOnDemand(){
			var connectorStartTime = new Date();
			var cRecord = currentRecord.get();
			taxLibrary.AVA_CalculateTaxOnDemand(cRecord, connectorStartTime);
		}
		
		function AVA_ValidateAddress(mode){
			var cRecord = currentRecord.get();
			
			if(cRecord.getValue('custpage_ava_configobj') != null && cRecord.getValue('custpage_ava_configobj').length > 0){
				var configCache = JSON.parse(cRecord.getValue('custpage_ava_configobj'));
				ava_library.AVA_ValidateAddress(cRecord, configCache, mode);
			}
		}
		
		function AVA_OpenPurchaseOrder(entityid, recTransId){
			window.open('/app/accounting/transactions/purchord.nl?cf=78&entity=&whence=&entityid=' + entityid + '&recordId=' + recTransId + '');
		}
		
		return{
			pageInit: AVA_TransactionInit,
			fieldChanged: AVA_TransactionFieldChanged,
			postSourcing: AVA_TransactionPostSourcing,
			sublistChanged: AVA_TransactionSublistChanged,
			validateLine: AVA_TransactionValidateLine,
			saveRecord: AVA_TransactionSave,
			AVA_CalculateOnDemand: AVA_CalculateOnDemand,
			AVA_ValidateAddress: AVA_ValidateAddress,
			AVA_OpenPurchaseOrder: AVA_OpenPurchaseOrder
		};
	}
);