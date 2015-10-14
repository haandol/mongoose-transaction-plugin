export class BaseError {
  constructor() {
    Error.apply(this, arguments);
  }
}

export enum TransactionErrors {
  BROKEN_DATA             = 40,
  SOMETHING_WRONG         = 41, // data not found or mongo response error
  TRANSACTION_CONFLICT_1  = 42, // sequence save
  TRANSACTION_CONFLICT_2  = 43, // transacted lock
  TRANSACTION_EXPIRED     = 44,
  COMMON_ERROR_RETRY      = 45,
  JUST_RETRY              = 46,
  INVALID_COLLECTION      = 50,
  UNKNOWN_COMMIT_ERROR    = 60,
  INFINITE_LOOP           = 70
}

export class TransactionError extends BaseError {
  public name: string = 'TransactionError';
  public message: string;
  public code: TransactionErrors;

  constructor(code?: TransactionErrors) {
    super();
    this.message = TransactionError[code];
    this.code = code;
  }
}