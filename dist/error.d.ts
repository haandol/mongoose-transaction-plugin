export declare class BaseError {
    constructor();
}
export declare enum TransactionErrors {
    BROKEN_DATA = 40,
    SOMETHING_WRONG = 41,
    TRANSACTION_CONFLICT_1 = 42,
    TRANSACTION_CONFLICT_2 = 43,
    TRANSACTION_EXPIRED = 44,
    COMMON_ERROR_RETRY = 45,
    JUST_RETRY = 46,
    INVALID_COLLECTION = 50,
    UNKNOWN_COMMIT_ERROR = 60,
    INFINITE_LOOP = 70,
}
export declare class TransactionError extends BaseError {
    name: string;
    message: string;
    code: TransactionErrors;
    constructor(code?: TransactionErrors);
}
