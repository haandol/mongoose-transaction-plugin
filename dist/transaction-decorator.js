var Promise = require('bluebird');
var _debug = require('debug');
var transaction_1 = require('./transaction');
var debug = _debug('ISLAND:CTRL:TRANSACTION');
function transactional(target, key, desc) {
    var originalMethod = desc.value;
    desc.value = function () {
        var _this = this;
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i - 0] = arguments[_i];
        }
        debug('START @transactional');
        return Promise.using(new transaction_1.Transaction().begin(), function (t) {
            if (args[args.length] !== undefined)
                throw new Error('last parameter must be a Transaciton object.');
            args[args.length] = t;
            return originalMethod.apply(_this, args);
        });
    };
}
exports.transactional = transactional;
//# sourceMappingURL=transaction-decorator.js.map