var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var BaseError = (function () {
    function BaseError() {
        Error.apply(this, arguments);
    }
    return BaseError;
})();
exports.BaseError = BaseError;
(function (TransactionErrors) {
    TransactionErrors[TransactionErrors["BROKEN_DATA"] = 40] = "BROKEN_DATA";
    TransactionErrors[TransactionErrors["SOMETHING_WRONG"] = 41] = "SOMETHING_WRONG";
    TransactionErrors[TransactionErrors["TRANSACTION_CONFLICT_1"] = 42] = "TRANSACTION_CONFLICT_1";
    TransactionErrors[TransactionErrors["TRANSACTION_CONFLICT_2"] = 43] = "TRANSACTION_CONFLICT_2";
    TransactionErrors[TransactionErrors["TRANSACTION_EXPIRED"] = 44] = "TRANSACTION_EXPIRED";
    TransactionErrors[TransactionErrors["COMMON_ERROR_RETRY"] = 45] = "COMMON_ERROR_RETRY";
    TransactionErrors[TransactionErrors["JUST_RETRY"] = 46] = "JUST_RETRY";
    TransactionErrors[TransactionErrors["INVALID_COLLECTION"] = 50] = "INVALID_COLLECTION";
    TransactionErrors[TransactionErrors["UNKNOWN_COMMIT_ERROR"] = 60] = "UNKNOWN_COMMIT_ERROR";
    TransactionErrors[TransactionErrors["INFINITE_LOOP"] = 70] = "INFINITE_LOOP";
})(exports.TransactionErrors || (exports.TransactionErrors = {}));
var TransactionErrors = exports.TransactionErrors;
var TransactionError = (function (_super) {
    __extends(TransactionError, _super);
    function TransactionError(code) {
        _super.call(this);
        this.name = 'TransactionError';
        this.message = TransactionError[code];
        this.code = code;
    }
    return TransactionError;
})(BaseError);
exports.TransactionError = TransactionError;
//# sourceMappingURL=error.js.map