/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @Author Toby Wiedermann
 */

define(['N/log', 'N/runtime'], function (log, runtime) {
    function getModalHTML(recordId, oldClasses) {
        return `
            <style>
                #modalOverlay {
                    display:none;
                    position:fixed;
                    top:0; left:0;
                    width:100%; height:100%;
                    background:rgba(0,0,0,0.4);
                    z-index:9999;
                }
                #modalBox {
                    background:#fff;
                    width:350px;
                    margin:120px auto;
                    padding:20px;
                    border-radius:6px;
                }
                #modalBox h2 {
                    margin-top:0;
                }
                .modal-row {
                    margin-bottom:12px;
                }
                .modal-row label {
                    display:block;
                    margin-bottom:4px;
                }
                .modal-row input {
                    width:100%;
                    padding:6px;
                    box-sizing:border-box;
                }
                .modal-buttons {
                    text-align:right;
                }
                .modal-buttons button {
                    margin-left:8px;
                }
                .loading-btn {
                    position: relative;
                    pointer-events: none;
                    opacity: 0.7;
                    color: transparent;
                }

                .loading-btn::after {
                    content: '';
                    display: block;
                    width: 16px;
                    height: 16px;
                    border: 2px solid #ccc;
                    border-top-color: #333;
                    border-radius: 50%;
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    animation: spin 0.8s linear infinite;
                }
                @keyframes spin {
                    from { transform: translate(-50%, -50%) rotate(0deg); }
                    to { transform: translate(-50%, -50%) rotate(360deg); }
                }
            </style>
            <button id="openModal">Replace Item Class</button>
            <div id="modalOverlay">
                <div class="modalBox" id="modalBox">
                    <h2>Replace Item Class</h2>
                    <div class="modal-row">
                        <label>Select class to replace:</label>
                        <select id="oldClass">${oldClasses.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
                        <label>Enter new class:</label>
                        <input type="text" id="newClass"/>
                    </div>
                    <div class="modal-buttons">
                        <button type="button" id="cancelButton">Cancel</button>
                        <button type="button" id="submitButton">Submit</button>
                    </div>
                </div>
            </div>
            <script>
                (function() {
                    var btn = document.getElementById('openModal');
                    var overlay = document.getElementById('modalOverlay');
                    var cancel = document.getElementById('cancelButton');
                    var submit = document.getElementById('submitButton');

                    function startLoading(btn) {
                        btn.dataset.originalText = btn.textContent;
                        btn.textContent = '';
                        btn.classList.add('loading-btn');
                        btn.disabled = true;
                        cancel.disabled = true;
                        document.getElementById('newClass').disabled = true;
                        document.getElementById('oldClass').disabled = true;
                    }

                    function stopLoading(btn) {
                        btn.classList.remove('loading-btn');
                        btn.textContent = btn.dataset.originalText || 'Submit';
                        btn.disabled = false;
                        cancel.disabled = false;
                        document.getElementById('newClass').disabled = false;
                        document.getElementById('oldClass').disabled = false;
                    }

                    btn.addEventListener('click', function(e) {
                        e.preventDefault()
                        overlay.style.display = 'block';
                    });
                    cancel.addEventListener('click', function(e) {
                        e.preventDefault();
                        overlay.style.display = 'none';
                        document.getElementById('newClass').focus();
                    });
                    submit.addEventListener('click', async function(e) {
                        e.preventDefault();
                        startLoading(submit);
                        var oldClass = document.getElementById('oldClass').value;
                        var newClass = document.getElementById('newClass').value.trim().toUpperCase();
                        if (!newClass) {
                            alert('Please enter a new class');
                            stopLoading(submit);
                            return;
                        }
                        try {
                            var response = await fetch(
                                '/app/site/hosting/scriptlet.nl?script=customscript5661&deploy=customdeploy1&nocache=1'
                                + '&recordId=' + encodeURIComponent('${recordId}')
                                + '&oldClass=' + encodeURIComponent(oldClass)
                                + '&replacementClass=' + encodeURIComponent(newClass)
                            );
                            var data = await response.json();
                            if (data.success) {
                                if (data.result.partial) {
                                    var proceed = confirm(
                                        'The following item(s) do not exist in the ' + newClass + ' class: ' + data.result.missingItems.join(', ') +
                                        '. Do you want to replace the rest of the items anyway?'
                                    );
                                    if (!proceed) {
                                        stopLoading(submit);
                                        return;
                                    }
                                    var confirmResponse = await fetch(
                                        '/app/site/hosting/scriptlet.nl?script=customscript5661&deploy=customdeploy1&nocache=1'
                                        + '&recordId=' + encodeURIComponent('${recordId}')
                                        + '&oldClass=' + encodeURIComponent(oldClass)
                                        + '&replacementClass=' + encodeURIComponent(newClass)
                                        + '&allowPartial=T'
                                    );
                                    var finalData = await confirmResponse.json();
                                    alert(finalData.result.message || 'Replacement completed.');
                                    overlay.style.display = 'none';
                                    location.reload();
                                    return;
                                } else {
                                    alert(data.result.message || data.result);
                                    overlay.style.display = 'none';
                                    location.reload();
                                    return;
                                }
                            } else {
                                alert('Error: ' + (data.error || 'Unknown error'));
                                stopLoading(submit);
                                return;
                            }
                        } catch (e) {
                            stopLoading(submit);
                            alert('Request failed');
                        }
                    });
                })();
            </script>
        `;
    }

    function beforeLoad(context) {
        // only allow for certain users
        const userId = Number(runtime.getCurrentUser().id);
        const allowedUsers = [192348, 86815, 185281, 94242];
        // if (!allowedUsers.includes(userId)) {
        //     return;
        // }
        try {
            const rec = context.newRecord;
            if (runtime.executionContext !== runtime.ContextType.USER_INTERFACE) return;
            if (!['salesorder', 'estimate'].includes(rec.type)) return;
            if (context.type === context.UserEventType.VIEW) return;

            const form = context.form;

            // log.debug('field found?', form.getField({ id: 'custbody_tw_replace_items' }) != null);

            // getting the list of old classes of the items
            const lineCount = rec.getLineCount({ sublistId: 'item' });
            let oldClasses = [];
            const classMap = {};
            try {
                if (lineCount > 0) {
                    for (let i = 0; i < lineCount; i++) {
                        const itemText = rec.getSublistText({ sublistId: 'item', fieldId: 'item', line: i });
                        if (!itemText || itemText === 'Tariff Charges') continue;
                        const itemClass = itemText.split('-')[0];
                        if (!itemText || itemText === 'Tariff Charges') continue;
                        if (!classMap[itemClass]) {
                            classMap[itemClass] = true;
                            if (itemClass != 'CT') {
                                oldClasses.push(itemClass); // don't add teh CT charges lines to the list of classes
                            }
                            
                        }
                    }
                }
            } catch(e) {}
            // let oldClass = '';
            // try {
            //     const lineCount = rec.getLineCount({ sublistId: 'item' });
            //     if (lineCount > 0) {
            //         let firstItem = rec.getSublistText({ sublistId: 'item', fieldId: 'item', line: 0 });
            //         oldClass = firstItem.split('-')[0];
            //     }
            // } catch (e) { }
            if (context.type !== context.UserEventType.VIEW && rec.id) {
                const htmlField = form.addField({
                    id: 'custpage_replace_items_button',
                    label: ' ',
                    type: 'inlinehtml',
                    container: 'items'
                });
                htmlField.defaultValue = getModalHTML(rec.id || '', oldClasses);
            }
        } catch (e) {
            log.error('@beforeLoad', e.message);
        }

    }

    return { beforeLoad };

});