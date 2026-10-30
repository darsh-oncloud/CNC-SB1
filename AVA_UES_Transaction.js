/******************************************************************************************************
	Script Name - AVA_UES_Transaction.js
	Company -     Avalara Technologies Pvt Ltd.
******************************************************************************************************/

/**
 *@NApiVersion 2.1
 *@NScriptType UserEventScript
*/

define(['N/ui/serverWidget', 'N/runtime', 'N/cache', './utility/AVA_Library', './utility/AVA_CommonServerFunctions', './utility/AVA_TaxLibrary'],
	(ui, runtime, cache, ava_library, ava_commonFunction, taxLibrary) => {
		const AVA_TransactionTabBeforeLoad = (context) => {
			let connectorStartTime = new Date();
			let cForm = context.form;
			let nRecord = context.newRecord;
			
			if(runtime.executionContext == runtime.ContextType.USER_INTERFACE){
				context.form.clientScriptModulePath = './AVA_CLI_Transaction.js';
			}
			
			if(runtime.executionContext == runtime.ContextType.WEBSTORE && nRecord.getValue('entity') <= 0){
				return;
			}
			
			let avaConfigCache = cache.getCache({
				name: 'avaConfigCache',
				scope: cache.Scope.PROTECTED
			});
			let configCache = avaConfigCache.get({
				key: 'avaConfigObjRec',
				loader: ava_library.AVA_LoadValuesToGlobals
			});
			
			if(configCache != null && configCache.length > 0){
				let subsidiaryCache = avaConfigCache.get({
					key: 'avaSubsidiaryObjRec',
					loader: ava_library.AVA_GetSubsidiaryDetails
				});				
				let configObject = cForm.addField({
					id: 'custpage_ava_configobj',
					label: 'Config Object',
					type: ui.FieldType.LONGTEXT
				});
				configObject.updateDisplayType({
					displayType: ui.FieldDisplayType.HIDDEN
				});
				configObject.defaultValue = configCache;
				configCache = JSON.parse(configCache);
				let subsidiaryObject = cForm.getField({
					id: 'custbody_ava_subsidiaryobj'
				});
				
				if(subsidiaryObject != null){
					subsidiaryObject.defaultValue = subsidiaryCache;
				}
				
				let details = cForm.addField({
					id: 'custpage_ava_details',
					label: 'Details',
					type: ui.FieldType.LONGTEXT
				});
				details.updateDisplayType({
					displayType: ui.FieldDisplayType.HIDDEN
				});
				
				if(configCache.AVA_AdditionalInfo3 != null && configCache.AVA_AdditionalInfo3.length > 0){
					details.defaultValue = configCache.AVA_AdditionalInfo3;
				}
				else if(configCache.AVA_AdditionalInfo != null && configCache.AVA_AdditionalInfo.length > 0){
					details.defaultValue = ava_commonFunction.mainFunction('AVA_General', (configCache.AVA_AccountValue + '+' + configCache.AVA_AdditionalInfo + '+' + configCache.AVA_AdditionalInfo1 + '+' + configCache.AVA_AdditionalInfo2));
				}
				
				taxLibrary.AVA_TransactionBeforeLoad(context, cForm, ui, nRecord, configCache, connectorStartTime);
			}
		}
		
		const AVA_TransactionTabBeforeSubmit = (context) => {
			let connectorStartTime = new Date();
			let nRecord = context.newRecord;
			
			if(nRecord.getValue('custbody_ava_disable_tax_calculation') == true){
				return;
			}
			
			let avaConfigCache = cache.getCache({
				name: 'avaConfigCache',
				scope: cache.Scope.PROTECTED
			});
			let configCache = avaConfigCache.get({
				key: 'avaConfigObjRec',
				loader: ava_library.AVA_LoadValuesToGlobals
			});
			
			if(configCache != null && configCache.length > 0){
				let subsidiaryCache = avaConfigCache.get({
					key: 'avaSubsidiaryObjRec',
					loader: ava_library.AVA_GetSubsidiaryDetails
				});
				
				taxLibrary.AVA_TransactionBeforeSubmit(context, nRecord, JSON.parse(configCache), JSON.parse(subsidiaryCache), connectorStartTime);
			}
		}
		
		const AVA_TransactionTabAfterSubmit = (context) => {
			let connectorStartTime = new Date();
			let nRecord = context.newRecord;
			
			if((runtime.executionContext == runtime.ContextType.WEBAPPLICATION || runtime.executionContext == runtime.ContextType.PAYMENTPOSTBACK) && (context.type == context.UserEventType.CREATE || context.type == context.UserEventType.EDIT || context.type == context.UserEventType.XEDIT)){
				return;
			}
			
			let avaConfigCache = cache.getCache({
				name: 'avaConfigCache',
				scope: cache.Scope.PROTECTED
			});
			let configCache = avaConfigCache.get({
				key: 'avaConfigObjRec',
				loader: ava_library.AVA_LoadValuesToGlobals
			});
			
			if(configCache != null && configCache.length > 0){
				let details;
				let subsidiaryCache = avaConfigCache.get({
					key: 'avaSubsidiaryObjRec',
					loader: ava_library.AVA_GetSubsidiaryDetails
				});
				
				configCache = JSON.parse(configCache);
				
				if(configCache.AVA_AdditionalInfo3 != null && configCache.AVA_AdditionalInfo3.length > 0){
					details = configCache.AVA_AdditionalInfo3;
				}
				else if(configCache.AVA_AdditionalInfo != null && configCache.AVA_AdditionalInfo.length > 0){
					details = ava_commonFunction.mainFunction('AVA_General', (configCache.AVA_AccountValue + '+' + configCache.AVA_AdditionalInfo + '+' + configCache.AVA_AdditionalInfo1 + '+' + configCache.AVA_AdditionalInfo2));
				}
				
				taxLibrary.AVA_TransactionAfterSubmit(context, nRecord, configCache, JSON.parse(subsidiaryCache), connectorStartTime, details);
			}
		}
		
		return{
			beforeLoad: AVA_TransactionTabBeforeLoad,
			beforeSubmit: AVA_TransactionTabBeforeSubmit,
			afterSubmit: AVA_TransactionTabAfterSubmit
		};
	}
);
