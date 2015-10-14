import * as mongoose from 'mongoose';
import * as _ from 'lodash';
import * as Promise from 'bluebird';
import * as _debug from 'debug';
import * as events from 'events';
import { TransactionError, TransactionErrors } from './error';

let debug = _debug('transaction');

interface IHistory {
  // collection name
  col: string;
  // document's object id
  oid: mongoose.Types.ObjectId;
  // update query string.
  op: string;
}

interface ITransaction extends mongoose.Document {
  history: IHistory[];
  state: string;
}

export class Transaction extends events.EventEmitter {
  public static TRANSACTION_EXPIRE_THRESHOLD = 60 * 1000;

  private Transaction: mongoose.Model<ITransaction>;
  private transaction: ITransaction;
  private participants: mongoose.Document[] = [];

  constructor(connection: mongoose.Connection) {
    super();

    let historySchema = new mongoose.Schema({
      col: { type: String, required: true },
      oid: { type: mongoose.Schema.Types.ObjectId, required: true },
      op: { type: String, required: true }
    });

    let transactionSchema = new mongoose.Schema({
      history: [historySchema],
      state: { type: String, required: true, default: 'init' }
    });
    this.Transaction = connection.model<ITransaction>('Transaction', transactionSchema);
  }

  public begin(): Promise<void> {
    if (this.transaction) return Promise.reject<void>(new Error('Transaction has already been started'));

    let transaction = new this.Transaction();
    return Promise.resolve(transaction.save<ITransaction>()).then(doc => {
      this.transaction = <any>doc;
      debug('transaction created: %o', doc);
    });
  }

  public cancel(): Promise<void> {
    if (!this.transaction) return Promise.reject<void>(new Error('Could not find any transaction'));
    if (this.transaction.state && this.transaction.state !== 'init') return Promise.reject<void>(new Error('Invalid state: ' + this.transaction.state));

    return Promise.resolve(this.transaction.remove()).then(() => {
      return Promise.all(this.participants.map(participant => {
        // TODO: Promise.defer is deprecated
        let deferred = Promise.defer<void>();
        participant.update({$unset: {__t: ''}}, {}, (err, affrectedRows, raw) => {
          if (err) return deferred.reject(err);
          if (affrectedRows !== 1) debug('[WARNING] unlock failed');
          return deferred.resolve();
        });
        return deferred.promise;
      }));
    }).then(() => {
      debug('transaction cancelled');
      this.transaction = undefined;
      this.participants = [];
    });
  }

  public commit(): Promise<void> {
    if (!this.transaction) return Promise.resolve();

    return Promise.all(this.participants.map(participant => {
      // TODO: Promise.defer is deprecated
      let deferred = Promise.defer<void>();
      participant.validate(err => {
        if (err) return deferred.reject(err);
        debug('delta: %o', (<any>participant).$__delta());
        this.transaction.history.push({
          col: (<any>participant).collection.name,
          oid: participant._id,
          op: JSON.stringify(((<any>participant).$__delta() || [null, {}])[1])
        });
        return deferred.resolve();
      });
      return deferred.promise;
    })).then(() => {
      debug('history generated: %o', this.transaction.history);
      this.transaction.state = 'pending';
      return this.transaction.save<ITransaction>();
    }).then(doc => {
      this.transaction = <any>doc;
      debug('apply participants\' changes');
      return Promise.map(this.participants, participant => participant.save());
    }).then(() => {
      debug('change state from (init) to (committed)');
      this.transaction.state = 'committed';
      return this.transaction.save<ITransaction>();
    }).then(doc => {
      debug('transaction committed', doc);
      this.transaction = undefined;
      this.participants = [];
    }).catch(err => {
      return this.cancel().then(() => { throw err; });
    });
  }

  public add(doc: mongoose.Document) {
    // TODO: implements
  }

  public remove() {
    // TODO: implements
  }

  public findOne<T extends mongoose.Document>(model: mongoose.Model<T>, cond: Object, fields?: Object, options?: Object) {
    let opt = _.cloneDeep(options || {});
    opt['__t'] = this.transaction._id;

    debug('attempt write lock', opt)
    return Promise.resolve(model.findOne(cond, fields, opt).exec()).then(doc => {
      this.participants.push(doc);
      return doc;
    });
  }
}