Ext.define("TSDependencyStatusReport", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    
    layout: 'border',
    
    items: [
        {xtype:'container',itemId:'selector_box', region: 'north'},
        {xtype:'container',itemId:'display_box', region: 'center', layout: 'fit'}
    ],

    integrationHeaders : {
        name : "TSDependencyStatusReport"
    },

    launch: function() {
        var me = this;
        this._addPortfolioItemSelector(this.down('#selector_box'));
    },
      
    _addPortfolioItemSelector: function(container) {
        container.add({ 
            xtype:'portfolioitempickerbutton',
            layout: 'hbox',
            listeners: {
                scope: this,
                itemschosen: function(picker,items) {
                    this.PIs = items;
                    if ( this.PIs.length > 0 ) {
                        this._updateData();
                    }
                }
            }
        });
    },
    
    _updateData: function() {
        this.logger.log("_updateData", this.PIs);
        
        Deft.Chain.pipeline([
            this._getChildFeatures,
            this._getRelatedFeatures,
            this.__getParents
        ],this).then({
            scope: this,
            success: function(results) {
                var rows = this._makeRowsFromHash(this.baseFeaturesByOID);
                this._makeGrid(rows);
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem Fetching Data', msg);
            }
        });
    },
    
    _getChildFeatures: function() {
        this.setLoading('Fetching descendant features...');
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
        
        var filter_configs = Ext.Array.map(this.PIs, function(pi) {
            return [
                {property:'Parent.ObjectID',value:pi.get('ObjectID')},
                {property:'Parent.Parent.ObjectID',value:pi.get('ObjectID')}
            ];
        });
        
        var filters = Rally.data.wsapi.Filter.or(Ext.Array.flatten(filter_configs));
        var config = {
            model: 'PortfolioItem/Feature',
            filters: filters,
            context: { project: null },
            fetch: ['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate',
                'PlannedEndDate','PlannedStartDate','Project','Owner','Release']
        }
        
        this._loadWsapiRecords(config).then({
            scope: this,
            success: function(features) {
                this.logger.log("First level features:", features);
                deferred.resolve(features);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        }).always(function() { me.setLoading(false); });
        
        return deferred.promise;
    },
    
    _getRelatedFeatures: function(base_features) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        this.setLoading('Fetching predecessors/successors...');
        
        this.baseFeaturesByOID = {};
        var promises = [];
        
        Ext.Array.each(base_features, function(feature){
            this.baseFeaturesByOID[feature.get('ObjectID')] = feature;
            promises.push(function() { return this._getPredecessors(feature); });
            promises.push(function() { return this._getSuccessors(feature); });
            
        },this);
        
        Deft.Chain.sequence(promises,this).then({
            scope: this,
            success: function(results) {
                this.relatedFeatures = Ext.Array.flatten(results);
                
                this.logger.log("RETURNED:", this.relatedFeatures);
                this.logger.log('Base Features', this.baseFeaturesByOID);
                deferred.resolve(this.relatedFeatures);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        }).always(function() { me.setLoading(false); });
        
        return deferred.promise;
    },
    
    // getting the parents lets us get the grandparents
    __getParents: function(leaf_features) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
            
        var base_features = Ext.Object.getValues(this.baseFeaturesByOID);
        
        var oids = [];
        Ext.Object.each(this.baseFeaturesByOID, function(key,feature){
            var parent_oid = feature.get('Parent') && feature.get('Parent').ObjectID;
            if ( !Ext.isEmpty(parent_oid) ) {
                oids.push(parent_oid);
            }
        });
        
        Ext.Array.each(leaf_features, function(feature){
            var parent_oid = feature.get('Parent') && feature.get('Parent').ObjectID;
            if ( !Ext.isEmpty(parent_oid) ) {
                oids.push(parent_oid);
            }
        });
        
        var filters = Ext.Array.map(Ext.Array.unique(oids), function(oid){
            return { property:'ObjectID',value:oid};
        });
        
        var config = {
            model:'PortfolioItem/Initiative',
            filters: Rally.data.wsapi.Filter.or(filters),
            context: { project: null },
            fetch:['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate',
                'PlannedEndDate','PlannedStartDate','Project','Owner','Release']
        };
        
        this._loadWsapiRecords(config).then({
            success: function(results) {
                me.parentsByOID = {};
                Ext.Array.each(results, function(result){
                    var oid = result.get('ObjectID');
                    var data = result.getData();
                    me.parentsByOID[oid] = data;
                });
                
                deferred.resolve(leaf_features);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        
        return deferred.promise;
        
    },
    
    _getPredecessors: function(feature) {
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
            
        this.logger.log('Finding predecessors for', feature.get('FormattedID'));
        if ( feature.get('Predecessors').Count === 0 ) {
            feature.set('_predecessors', []);
            return [];
        }
        
        feature.getCollection('Predecessors').load({
            fetch: ['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate',
                'PlannedEndDate','PlannedStartDate','Project','Owner','Release'],
            scope: this,
            callback: function(records, operation, success) {
                feature.set('_predecessors', records);
                deferred.resolve(records);
            }
        });
        
        return deferred.promise;
    },
    
    _getSuccessors: function(feature) {
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
            
        this.logger.log('Finding successors for', feature.get('FormattedID'));
        if ( feature.get('Successors').Count === 0 ) {
            feature.set('_successors', []);
            return [];
        }
        
        feature.getCollection('Successors').load({
            fetch: ['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate',
                'PlannedEndDate','PlannedStartDate','Project','Owner','Release'],
            scope: this,
            callback: function(records, operation, success) {
                feature.set('_successors', records);
                deferred.resolve(records);
            }
        });
        
        return deferred.promise;
    },
    
    _makeRowsFromHash: function(base_features_by_oid){
        var me = this,
            rows = [];
        // this.parentsByOID
        
        Ext.Object.each(base_features_by_oid, function(oid,feature){
            var initiative_oid = feature.get('Parent') && feature.get('Parent').ObjectID;
            
            var theme_fid = null;
            var theme_name = null;
            if ( !Ext.isEmpty(initiative_oid) && !Ext.isEmpty(me.parentsByOID[initiative_oid]) && !Ext.isEmpty(me.parentsByOID[initiative_oid].Parent)) {
                theme_fid = me.parentsByOID[initiative_oid].Parent.FormattedID;
                theme_name = me.parentsByOID[initiative_oid].Parent.Name;
            }
            var row = Ext.Object.merge({
                _level: 0,
                _theme_fid: theme_fid,
                _theme_name: theme_name,
                _initiative_fid: feature.get('Parent') && feature.get('Parent').FormattedID,
                _initiative_name: feature.get('Parent') && feature.get('Parent').Name
            }, feature.getData());
            
            rows.push(row);
            
            Ext.Array.each(feature.get('_predecessors'), function(dependency){
                var initiative_oid = dependency.get('Parent') && dependency.get('Parent').ObjectID;
                theme_fid = null;
                theme_name = null;
                if ( !Ext.isEmpty(initiative_oid) && !Ext.isEmpty(me.parentsByOID[initiative_oid]) && !Ext.isEmpty(me.parentsByOID[initiative_oid].Parent)) {
                    theme_fid = me.parentsByOID[initiative_oid].Parent.FormattedID;
                    theme_name = me.parentsByOID[initiative_oid].Parent.Name;
                }
                
                rows.push(Ext.Object.merge({
                    _level: 1,
                    _theme_fid: theme_fid,
                    _theme_name: theme_name,
                    _initiative_fid: dependency.get('Parent') && dependency.get('Parent').FormattedID,
                    _initiative_name: dependency.get('Parent') && dependency.get('Parent').Name
                }, dependency.getData()));
            });
            
            Ext.Array.each(feature.get('_successors'), function(dependency){
                var initiative_oid = dependency.get('Parent') && dependency.get('Parent').ObjectID;
                theme_fid = null;
                theme_name = null;
                if ( !Ext.isEmpty(initiative_oid) && !Ext.isEmpty(me.parentsByOID[initiative_oid]) && !Ext.isEmpty(me.parentsByOID[initiative_oid].Parent)) {
                    theme_fid = me.parentsByOID[initiative_oid].Parent.FormattedID;
                    theme_name = me.parentsByOID[initiative_oid].Parent.Name;
                }
                rows.push(Ext.Object.merge({
                    _level: 1,
                    _theme_fid: theme_fid,
                    _theme_name: theme_name,
                    _initiative_fid: dependency.get('Parent') && dependency.get('Parent').FormattedID,
                    _initiative_name: dependency.get('Parent') && dependency.get('Parent').Name
                }, dependency.getData()));
            });
        });
        return rows;
    },
    
    _makeGrid: function(rows) {
        var me = this,
            container = this.down('#display_box');
            
        this.rows = [];
        container.removeAll();
        
        var store = Ext.create('Rally.data.custom.Store',{ data: rows});
        
        container.add({
            xtype:'rallygrid',
            store: store,
            columnCfgs: this._getColumns(),
            showRowActionsColumn: false
        });
    },
    
    _getColumns: function() {
        var columns = [];

        columns.push({dataIndex:'_theme_name',text:'Theme'});

        columns.push({dataIndex:'_initiative_fid',text:'Initiative ID'});
        columns.push({dataIndex:'_initiative_name',text:'Initiative Name'});
        
        columns.push({dataIndex:'FormattedID',text:'id'});
        columns.push({dataIndex:'Name',text:'Name'});
        columns.push({dataIndex:'PercentDoneByStoryCount',text: '% Complete by Story Count'});
        columns.push({dataIndex:'PercentDoneByStoryPlanEstimate',text: '% Complete by Story Points'});
        columns.push({
            dataIndex:'Project',
            text:'Project/Team', 
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) { return "--"; }
                return value._refObjectName;
            }
        });
        columns.push({
            dataIndex:'Owner',
            text:'Feature Owner', 
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) { return "--"; }
                return value._refObjectName;
            }
        });
        columns.push({
            dataIndex:'Release',
            text:'Release', 
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) { return "--"; }
                return value._refObjectName;
            }
        });
        
        columns.push({dataIndex:'PlannedStartDate',text: 'Planned Start Date'});
        columns.push({dataIndex:'PlannedEndDate',text: 'Planned End Date'});

        return columns;
    },
    
    _loadWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        var default_config = {
            model: 'Defect',
            fetch: ['ObjectID'],
            compact: false
        };
        this.logger.log("Starting load:",config.model);
        Ext.create('Rally.data.wsapi.Store', Ext.Object.merge(default_config,config)).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(records);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },
    
    _displayGrid: function(store,field_names){
        this.down('#display_box').add({
            xtype: 'rallygrid',
            store: store,
            columnCfgs: field_names
        });
    },
    
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },
    
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        // Ext.apply(this, settings);
        this.launch();
    }
});