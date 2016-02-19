var mongoose = require('mongoose');
var _debug = require('debug');
var Promise = require('bluebird');
var utils_1 = require('./utils');
var debug = _debug('ISLAND:TRANSACTION:PLUGIN');
function plugin(schema, options) {
    schema.add({
        __t: { type: mongoose.Schema.Types.ObjectId },
    });
    schema.pre('save', function (next) {
        debug('pre-save');
        debug('checking __t field: ', this.__t);
        if (!this.__t)
            return next(new Error('You can\' not save without lock'));
        // TODO:
        // if (this.__t.toString().substring(8, 18) !== '0000000000') return next(new Error(''));
        this.__t = undefined;
        next();
    });
    schema.pre('findOne', function (next) {
        var _this = this;
        debug('pre-findOne');
        debug('options: %o', this.options);
        if (this.options.force)
            return next();
        debug('conditions: %o', this._conditions);
        return Promise.resolve(this.model.findOne(this._conditions, { _id: 1, __t: 1 }, { force: true }).exec()).then(function (doc) {
            if (!doc)
                return next();
            debug('document found! t : ', doc.__t, ', id : ', doc.id);
            // TODO: transaction recommit
            if (doc.__t) {
                if (_this.options.__t && _this.options.__t.equals(doc.__t)) {
                    debug('already locked: ', doc.__t);
                    return next();
                }
            }
            _this._conditions['_id'] = doc._id;
            _this._conditions['__t'] = { '$exists': false };
            debug('conditions are modified', _this._conditions);
            var update = { __t: _this.options.__t || utils_1.ObjectId.get(Date.now()) };
            debug('update query is modified %o', update);
            // NOTE: write concern
            // http://docs.mongodb.org/manual/core/write-concern/
            return Promise.resolve(_this.model.update(_this._conditions, update, { force: true, w: 1 }).exec()).then(function (rawResponse) {
                debug('rawResponse: %o', rawResponse);
                if (rawResponse.n > 0 && rawResponse.nModified > 0 && rawResponse.n === rawResponse.nModified) {
                    debug('locking success');
                    delete _this._conditions['__t'];
                    debug('rollback conditions', _this._conditions);
                    if (_this._fields)
                        _this._fields['__t'] = 1;
                    return next();
                }
                return next('write lock');
            });
        }).catch(next);
    });
}
exports.plugin = plugin;
//# sourceMappingURL=plugin.js.map