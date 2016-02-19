var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var mongoose = require('mongoose');
var _ = require('lodash');
var Promise = require('bluebird');
var _debug = require('debug');
var events = require('events');
var debug = _debug('transaction');
var RETRYCOUNT = 5;
var RetryTimeTable = [197, 173, 181, 149, 202];
var Transaction = (function (_super) {
    __extends(Transaction, _super);
    function Transaction() {
        _super.apply(this, arguments);
        this.participants = [];
    }
    Transaction.initialize = function (connection) {
        if (this.model)
            return;
        var historySchema = new mongoose.Schema({
            col: { type: String, required: true },
            oid: { type: mongoose.Schema.Types.ObjectId, required: true },
            op: { type: String, required: true },
            query: { type: String, required: true }
        });
        var transactionSchema = new mongoose.Schema({
            history: [historySchema],
            state: { type: String, required: true, default: 'init' }
        });
        this.model = connection.model('Transaction', transactionSchema);
    };
    Transaction.prototype.begin = function () {
        var _this = this;
        return Promise.try(function () {
            if (!Transaction.model)
                throw new Error('Not initialized exception');
            if (_this.transaction)
                throw new Error('Transaction has already been started');
            var transaction = new Transaction.model();
            // TODO: should be fixed mongoose.d.ts
            return Promise.resolve(transaction.save()).then(function (doc) {
                _this.transaction = doc;
                debug('transaction created: %o', doc);
                return _this;
            });
        }).disposer(function (tx, promise) {
            if (promise.isFulfilled)
                return tx.commit();
            return tx.cancel();
        });
    };
    Transaction.prototype.cancel = function () {
        var _this = this;
        if (!this.transaction)
            return Promise.resolve();
        return Promise.try(function () {
            if (_this.transaction.state && _this.transaction.state !== 'init')
                return;
            return Promise.resolve(_this.transaction.remove()).then(function () {
                return Promise.each(_this.participants, function (participant) {
                    // TODO: Promise.defer is deprecated
                    // TODO: should be fixed mongoose.d.ts
                    if (participant.doc.isNew)
                        return participant.doc['__t'] = undefined;
                    return Promise.resolve(participant.doc.update({ $unset: { __t: '' } }, { w: 1 }, undefined).exec());
                }).catch(function (err) {
                    debug('[warning] removing __t has been failed');
                });
            });
        }).then(function () {
            _this.transaction = undefined;
            _this.participants = [];
        });
    };
    Transaction.prototype.commit = function () {
        var _this = this;
        if (!this.transaction)
            return Promise.resolve();
        return Promise.all(this.participants.map(function (participant) {
            // TODO: should be fixed mongoose.d.ts
            return Promise.resolve(participant.doc.validate(undefined)).then(function () {
                debug('delta: %o', participant.doc.$__delta());
                // TODO: 쿼리 제대로 만들기
                var query;
                if (participant.op === 'update') {
                    query = JSON.stringify((participant.doc.$__delta() || [null, {}])[1]);
                }
                else if (participant.op === 'remove') {
                    query = JSON.stringify({ _id: '' });
                }
                else if (participant.op === 'insert') {
                    query = JSON.stringify({});
                }
                _this.transaction.history.push({
                    col: participant.doc.collection.name,
                    oid: participant.doc._id,
                    op: participant.op,
                    query: query
                });
            });
        })).then(function () {
            debug('history generated: %o', _this.transaction.history);
            _this.transaction.state = 'pending';
            return Promise.resolve(_this.transaction.save()).catch(function (err) {
                _this.transaction.state = 'init';
                throw err;
            });
        }).then(function (doc) {
            _this.transaction = doc;
            debug('apply participants\' changes');
            return Promise.map(_this.participants, function (participant) {
                if (participant.op === 'remove')
                    return participant.doc.remove();
                else
                    return participant.doc.save();
            }).catch(function (err) {
                // 여기서부터는 무조껀 성공해야 한다
                // 유저한테 에러를 던져야 할까? 언젠가는 처리될텐데...?
                // eventually consistency는 보장된다
                debug('실제 저장은 다 못했지만 언젠가 이 트랜젝션은 처리될 것이다', err);
                return;
            });
        }).then(function () {
            debug('change state from (pending) to (committed)');
            _this.transaction.state = 'committed';
            return Promise.resolve(_this.transaction.save()).catch(function (err) {
                debug('트랜젝션은 모두 처리되었지만 상태저장에 실패했을 뿐');
                return;
            });
        }).then(function (doc) {
            debug('transaction committed', doc);
            _this.transaction = undefined;
            _this.participants = [];
        }) /*.catch(err => {
          if (this.transaction.state !== 'init') throw err;
          return this.cancel().then(() => { throw err; });
        })*/;
    };
    // 생성될 document를 transaction에 참가시킴
    Transaction.prototype.insertDoc = function (doc) {
        if (!this.transaction)
            throw new Error('Could not find any transaction');
        doc['__t'] = this.transaction._id;
        this.participants.push({ op: 'insert', doc: doc });
    };
    // 삭제할 document를 transaction에 참가시킴
    Transaction.prototype.removeDoc = function (doc) {
        if (!this.transaction)
            throw new Error('Could not find any transaction');
        var id = doc['__t'];
        if (!id || id.toHexString() !== this.transaction.id)
            throw new Error('락이 이상함');
        this.participants.push({ op: 'remove', doc: doc });
    };
    Transaction.prototype.findOne = function (model, cond, fields, options) {
        var _this = this;
        return Promise.try(function () {
            if (!_this.transaction)
                throw new Error('Could not find any transaction');
            var p = _.find(_this.participants, function (p) {
                return p.model === model && JSON.stringify(cond) === JSON.stringify(p.cond);
            });
            if (p)
                return p.doc;
        })
            .then(function (doc) {
            if (doc)
                return doc;
            if (!options)
                options = {};
            if (options['retrycount'] === 0)
                options['retrycount'] = RETRYCOUNT;
            var opt = _.cloneDeep(options || {});
            opt['__t'] = _this.transaction._id;
            debug('attempt write lock', opt);
            return Promise.resolve(model.findOne(cond, fields, opt).exec())
                .then(function (doc) {
                if (!doc)
                    return;
                var p = _.find(_this.participants, function (p) {
                    return p.model === model && p.doc._id.equals(doc._id);
                });
                if (p)
                    return p.doc;
                _this.participants.push({ op: 'update', doc: doc, model: model, cond: cond });
                return doc;
            })
                .catch(function (err) {
                if (err !== 'write lock' || options['retrycount'] === 0)
                    return Promise.reject(err);
                options['retrycount'] -= 1;
                return Promise.delay(RetryTimeTable[Math.floor(Math.random() * RetryTimeTable.length)])
                    .then(function () { return _this.findOne(model, cond, fields, options); });
            });
        });
    };
    Transaction.TRANSACTION_EXPIRE_THRESHOLD = 60 * 1000;
    return Transaction;
})(events.EventEmitter);
exports.Transaction = Transaction;
//# sourceMappingURL=transaction.js.map