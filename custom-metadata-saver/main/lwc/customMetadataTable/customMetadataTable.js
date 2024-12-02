import { LightningElement, api, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import getSObjectApiName from '@salesforce/apex/CustomMetadataTableController.getSObjectApiName';
// import getPicklistOptions from '@salesforce/apex/CustomMetadataTableController.  ';
import deploy from '@salesforce/apex/CustomMetadataTableController.deploy';
import getDeploymentStatus from '@salesforce/apex/CustomMetadataTableController.getDeploymentStatus';

export default class CustomMetadataTable extends LightningElement {
    @api
    objectApiName;

    @api
    title = '';

    @api
    fieldsToDisplay = '';

    @api
    enableEditing = false;

    @api
    records = [];
    newRecord = {};
    newRecordDeveloperName = 'test';
    newRecordMasterLabel;
    _draftRecords;

    columns = ['DeveloperName'];
    defaultSortDirection = 'asc';
    sortedDirection;
    sortedBy;
    shouldShowNewRecordModal = false;

    isDeploying = false;
    deploymentStatus;
    deploymentMessage;
    _deploymentId;
    _resolvedDeploymentStatuses = ['Succeeded', 'Failed', 'Aborted'];

    connectedCallback() {
        // For SObject and List<SObject> variables in Flow, Flow Builder automatically asks
        // admins for the SObject Type - but this isn't exposed to lwc without using custom property editors (CPE),
        // which are terrible - 2/10 stars, would not recommend to a friend
        // Use the 1st record + Apex to dynamically determine the SObjectType
        let customMetadataRecord = this.records[0];
        getSObjectApiName({ customMetadataRecord: customMetadataRecord })
            .then(result => {
                this.objectApiName = result;
            })
            .catch(error => {
                // TODO error handling
            });
    }

    @wire(getObjectInfo, { objectApiName: '$objectApiName' })
    getSObjectDescribe({ error, data }) {
        if (error) {
            console.log('Error: ' + error);
        } else if (data) {
            this._loadColumns(data.fields);
            if (!this.title) {
                this.title = data.labelPlural;
            }
        }
    }

    closeNewRecordModal(event) {
        this.shouldShowNewRecordModal = false;
    }

    showNewRecordModal(event) {
        this.shouldShowNewRecordModal = true;
        this.newRecord = { DeveloperName: null, MasterLabel: null };
    }

    addNewRecord(event) {
        this.newRecord.DeveloperName = this.newRecordDeveloperName;
        this.newRecord.MasterLabel = this.newRecordMasterLabel;
        //console.log('New Record Creation Response: ' + JSON.stringify(this.newRecord));

        let records = JSON.parse(JSON.stringify(this.records));
        records.unshift(this.newRecord);
        this.records = records;

        this.newRecord = {};
        this.shouldShowNewRecordModal = false;
    }

    handleSort(event) {
        // TODO
    }

    handleCancel(event) {
        this.template.querySelector('lightning-datatable').draftValues = [];
    }

    async handleSave(event) {
        const draftValues = this.template.querySelector('lightning-datatable').draftValues;
        let updatedRecords = this._mergeDraftValues(draftValues);
        if (updatedRecords.length > 0) {
            this._deployCustomMetadataRecords(updatedRecords);
            await this._getDeploymentStatus();
        }
    }

    _showToastEvent(variant, title, message, messageData) {
        const event = new ShowToastEvent({
            title,
            message,
            variant
        });
        this.dispatchEvent(event);
    }

    _loadColumns(fields) {
        let sobjectFieldsByDeveloperName = new Map(Object.entries(fields));
        this.columns = [];

        this.fieldsToDisplay.split(',').forEach(fieldApiName => {
            fieldApiName = fieldApiName.trim();
            let field = sobjectFieldsByDeveloperName.get(fieldApiName);
            if (field) {
                let column = this._generateColumn(field);
                this.columns.push(column);
            }
        });
        //console.log('Table Columns: ' + JSON.stringify(this.columns));
    }

    _generateColumn(field) {
        let column = {
            label: field.label,
            fieldName: field.apiName,
            editable: this.enableEditing && field.apiName != 'DeveloperName',
            type: field.dataType.toLowerCase()
        };

        switch (column.type) {
            case 'date':
                column.type = 'date-local';
                break;
            case 'datetime':
                column.type = 'date';
                column.typeAttributes = {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                };
                break;
            case 'picklist':
                column.typeAttributes = {
                    // options: TODO - picklistOptions from Apex controller
                    value: { fieldName: column.fieldName },
                    context: { fieldName: 'DeveloperName' }
                };
                break;
            case 'string':
                column.type = 'text';
                break;
            case 'reference':
                // TODO add support for editing EntityDefinition/FieldDefinition lookup fields
                column.editable = false;
                break;
        }

        return column;
    }

    _mergeDraftValues(draftValues) {
        if (!draftValues) {
            return [];
        }

        var draftValuesByDeveloperName = draftValues.reduce(function (map, obj) {
            map[obj.DeveloperName] = obj;
            return map;
        }, {});

        this._draftRecords = [];
        let updatedRecords = [];
        this.records.forEach(record => {
            let recordDraftValues = draftValuesByDeveloperName[record.DeveloperName];
            if (recordDraftValues != null) {
                let updatedRecord = { ...record, ...recordDraftValues };
                this._draftRecords.push(updatedRecord);
                updatedRecords.push(updatedRecord);
            } else {
                this._draftRecords.push(record);
            }
        });

        return updatedRecords;
    }

    _deployCustomMetadataRecords(updatedRecords) {
        deploy({ customMetadataRecords: updatedRecords })
            .then(result => {
                //console.log('Scheduled Deployment Job ID: ' + result);
                this.isDeploying = true;
                this._deploymentId = result;
            })
            .then(result => {
                this._getDeploymentStatus();
            })
            .catch(error => {
                this.error = error;
            });
    }

    async _getDeploymentStatus() {
        if (this._deploymentId) {
            let deploymentStatusResponse = await getDeploymentStatus({ deploymentJobId: this._deploymentId });
            //console.log('Deployment Status Full Details: ' + JSON.stringify(deploymentStatusResponse));
            var jsonMessage = JSON.parse(deploymentStatusResponse);
            
            if (jsonMessage.deployResult.success) {
                this.deploymentStatus = jsonMessage.deployResult.status;
                //console.log('Deployment Status: ' + this.deploymentStatus);

                if (jsonMessage.deployResult.details.componentFailures.length > 0) {
                    this.deploymentMessage = 'Error: ' + jsonMessage.deployResult.details.componentFailures[0].problem;
                } else {
                    this.deploymentMessage = null;
                }

                const statusPromise = new Promise(resolve => {
                    let timeoutId;
                    if (this._resolvedDeploymentStatuses.includes(this.deploymentStatus) == false) {
                        timeoutId = setTimeout(() => this._getDeploymentStatus(), 2000);
                    } else {
                        this.isDeploying = null;
                        if (this.deploymentStatus == 'Succeeded') {
                            this.handleCancel();
                            this.records = this._draftRecords;
                        }
        
                        this._showToastEvent('success', 'Deployment Completed', 'Your changes were successfully deployed.');
                        clearTimeout(timeoutId);
                        resolve();
                    }
                });
                await statusPromise;
            }
            else {
                this.isDeploying = null;
                this.deploymentMessage = 'Error: ' + jsonMessage[0].message;
                this.handleCancel(); 
                this._showToastEvent('error', 'Deployment Status Check Failed', this.deploymentMessage);
            }
        }        
    }
}
