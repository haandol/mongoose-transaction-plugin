import * as mongoose from 'mongoose';
import * as _ from 'lodash';
import * as Promise from 'bluebird';
import * as _debug from 'debug';
import * as events from 'events';
import { TransactionError, TransactionErrors } from './error';

let debug = _debug('transaction');
let RETRYCOUNT = 5;
let RetryTimeTable = [197, 173, 181, 149, 202];

export interface IHistory {
  // collection name
  col: string;
  // document's object id
  oid: mongoose.Types.ObjectId;
  // insert, update, remove
  op: string;
  // update query string.
  query: string;
}

export interface ITransaction extends mongoose.Document {
  history: IHistory[];
  state: string;
}

export class Transaction extends events.EventEmitter {
  public static TRANSACTION_EXPIRE_THRESHOLD = 60 * 1000;
  private static model: mongoose.Model<ITransaction>;
  private static connection: mongoose.Connection;

  public static get getModel() { return Transaction.model; }

  private transaction: ITransaction;
  private participants: { op: string; doc: mongoose.Document; model?: any; cond?: Object;  }[] = [];

  public static initialize(connection: mongoose.Connection) {
    if (this.model) return;

    let historySchema = new mongoose.Schema({
      col: { type: String, required: true },
      oid: { type: mongoose.Schema.Types.ObjectId, required: true },
      op: { type: String, required: true },
      query: { type: String, required: true }
    });

    let transactionSchema = new mongoose.Schema({
      history: [historySchema],
      state: { type: String, required: true, default: 'init' }
    });
    this.connection = connection;
    this.model = connection.model<ITransaction>('Transaction', transactionSchema);
  }

  public begin() {
    return Promise.try(() => {
      if (!Transaction.model) throw new Error('Not initialized exception');
      if (this.transaction) throw new Error('Transaction has already been started');

      let transaction = new Transaction.model();
      // TODO: should be fixed mongoose.d.ts
      return Promise.resolve(transaction.save<ITransaction>()).then((doc) => {
        this.transaction = <any>doc;
        debug('transaction created: %o', doc);
        return this;
      });
    }).disposer((tx, promise) => {
      if (promise.isFulfilled()) {
        return tx.commit()
          .catch(e => {
            console.log('tx.commit failed', e);
          });
      }
      return tx.cancel()
        .catch(e => {
          console.log('tx.cancel failed', e);
        });
    });
  }

  static scope<R>(doInTransactionScope: (t: Transaction) => Promise<R>): Promise<R> {
    return Promise.using<Transaction, R>(new Transaction().begin(), doInTransactionScope);
  }

  public cancel(): Promise<void> {
    if (!this.transaction) return Promise.resolve();
    return Promise.try(() => {
      if (this.transaction.state && this.transaction.state !== 'init') return;

      return Promise.resolve(this.transaction.remove()).then(() => {
        return Promise.each(this.participants, participant => {
          // TODO: Promise.defer is deprecated
          // TODO: should be fixed mongoose.d.ts
          if (participant.doc.isNew) return participant.doc['__t'] = undefined;
          return Promise.resolve(participant.doc.update({$unset: {__t: ''}}, { w: 1 }, undefined).exec());
        }).catch(err => {
          debug('[warning] removing __t has been failed');
        });
      });
    }).then(() => {
      this.transaction = undefined;
      this.participants = [];
    });
  }

  public static recommit(transaction: ITransaction): Promise<void> {
    let histories = transaction.history;
    if (!histories) return Promise.resolve();

    return Promise.all(histories.map(history => {
      debug('find history collection: ', history.col, ' oid: ', history.oid);
      return new Promise((resolve, reject) => {
        this.connection.db.collection(history.col, function(err, collection) {
          if (err) {
            debug('Can not find collection: ', err);
            resolve();
          }
          let query = JSON.parse(history.query);
          query['$unset'] = query['$unset'] || {};
          query['$unset']['__t'] = '';
          debug('update recommit query is : ', query);
          collection.findOneAndUpdate({_id: history.oid}, query, function(err, doc) {
            debug('updated document ', doc);
            resolve();
          });
        });
      });
    }))
      .then(() => debug('transaction recommited!'));
  }

  public commit(): Promise<void> {
    if (!this.transaction) return Promise.resolve();

    return Promise.all(this.participants.map(participant => {
      // TODO: should be fixed mongoose.d.ts
      return new Promise((resolve, reject) => {
        participant.doc.validate(err => err && reject(err) || resolve());
      })
        .then(() => {
          debug('delta: %o', (<any>participant.doc).$__delta());
          // TODO: 쿼리 제대로 만들기
          let query: string;
          if (participant.op === 'update') {
            query = JSON.stringify(((<any>participant.doc).$__delta() || [null, {}])[1])
          } else if (participant.op === 'remove') {
            query = JSON.stringify({ _id: '' });
          } else if (participant.op === 'insert') {
            query = JSON.stringify({});
          }
          this.transaction.history.push({
            col: (<any>participant.doc).collection.name,
            oid: participant.doc._id,
            op: participant.op,
            query: query
          });
        });
    })).then(() => {
      debug('history generated: %o', this.transaction.history);
      this.transaction.state = 'pending';
      return Promise.resolve(this.transaction.save<ITransaction>()).catch(err => {
        this.transaction.state = 'init';
        throw err;
      });
    }).then(doc => {
      this.transaction = <any>doc;
      debug('apply participants\' changes');
      return Promise.map(this.participants, participant => {
        if (participant.op === 'remove') return participant.doc.remove();
        else return participant.doc.save();
      }).catch(err => {
        // 여기서부터는 무조껀 성공해야 한다
        // 유저한테 에러를 던져야 할까? 언젠가는 처리될텐데...?
        // eventually consistency는 보장된다
        debug('Fails to save whole transactions but they will be saved', err);
        return;
      });
    }).then(() => {
      debug('change state from (pending) to (committed)');
      this.transaction.state = 'committed';
      return Promise.resolve(this.transaction.save<ITransaction>()).catch(err => {
        debug('All transactions were committed but failed to save their status');
        return;
      });
    }).then(doc => {
      debug('transaction committed', doc);
      this.transaction = undefined;
      this.participants = [];
    })/*.catch(err => {
      if (this.transaction.state !== 'init') throw err;
      return this.cancel().then(() => { throw err; });
    })*/;
  }

  // 생성될 document를 transaction에 참가시킴
  public insertDoc(doc: mongoose.Document) {
    if (!this.transaction) throw new Error('Could not find any transaction');

    doc['__t'] = this.transaction._id;
    this.participants.push({ op: 'insert', doc: doc });
  }

  // 삭제할 document를 transaction에 참가시킴
  public removeDoc(doc: mongoose.Document) {
    if (!this.transaction) throw new Error('Could not find any transaction');

    let id: mongoose.Types.ObjectId = doc['__t'];
    if (!id || id.toHexString() !== this.transaction.id) throw new Error('락이 이상함');
    this.participants.push({ op: 'remove', doc: doc });
  }

  public findOne<T extends mongoose.Document>(model: mongoose.Model<T>, cond: Object, fields?: Object, options?: Object): Promise<T> {
    return Promise.try(() => {
      if (!this.transaction) throw new Error('Could not find any transaction');
      let p = _.find(this.participants, p => {
        return p.model === model && JSON.stringify(cond) === JSON.stringify(p.cond);
      });
      if (p) return <T>p.doc;
    })
      .then(doc => {
        if (doc) return doc;
        if (!options) options = { retrycount: 5 };
        if (options['retrycount'] === undefined) {
          debug('set retrycount ', options, options['retrycount']);
          options['retrycount'] = 5;
        }

        let opt = _.cloneDeep(options || {});
        opt['__t'] = this.transaction._id;
        opt['tModel'] = Transaction.getModel;

        debug('tModel before ', opt['tModel']);

        debug('attempt write lock', opt);
        return Promise.resolve(model.findOne(cond, fields, opt).exec())
          .then(doc => {
            if (!doc) return;
            let p = _.find(this.participants, p => {
              return p.model === model && p.doc._id.equals(doc._id);
            })
            if (p) return <T>p.doc;
            this.participants.push({op: 'update', doc: doc, model: model, cond: cond});
            return doc;
          })
          .catch(err => {
            debug('transaction err : retrycount is ', options['retrycount']);
            if (err !== 'write lock' || options['retrycount'] === 0) return Promise.reject(err);

            options['retrycount'] -= 1;
            return Promise.delay(RetryTimeTable[Math.floor(Math.random()*RetryTimeTable.length)])
              .then(() => this.findOne(model, cond, fields, options));
          });
      });
  }
}