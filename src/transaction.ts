import * as mongoose from 'mongoose';
import * as _ from 'lodash';
import * as Promise from 'bluebird';
import * as _debug from 'debug';
import * as events from 'events';
import { TransactionError, TransactionErrors } from './error';

let debug = _debug('transaction');
let RETRYCOUNT = 5;
let RetryTimeTable = [197, 173, 181, 149, 202];

interface IHistory {
  // collection name
  col: string;
  // document's object id
  oid: mongoose.Types.ObjectId;
  // insert, update, remove
  op: string;
  // update query string.
  query: string;
}

interface ITransaction extends mongoose.Document {
  history: IHistory[];
  state: string;
}

export class Transaction extends events.EventEmitter {
  public static TRANSACTION_EXPIRE_THRESHOLD = 60 * 1000;
  private static model: mongoose.Model<ITransaction>;

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
      if (promise.isFulfilled) return tx.commit();
      return tx.cancel();
    });
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

  public commit(): Promise<void> {
    if (!this.transaction) return Promise.resolve();

    return Promise.all(this.participants.map(participant => {
      // TODO: should be fixed mongoose.d.ts
      return Promise.resolve(participant.doc.validate(undefined)).then(() => {
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
        debug('실제 저장은 다 못했지만 언젠가 이 트랜젝션은 처리될 것이다', err);
        return;
      });
    }).then(() => {
      debug('change state from (pending) to (committed)');
      this.transaction.state = 'committed';
      return Promise.resolve(this.transaction.save<ITransaction>()).catch(err => {
        debug('트랜젝션은 모두 처리되었지만 상태저장에 실패했을 뿐');
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
        if (!options) options = {};
        if (options['retrycount'] === 0) options['retrycount'] = RETRYCOUNT;

        let opt = _.cloneDeep(options || {});
        opt['__t'] = this.transaction._id;

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
            if (err !== 'write lock' || options['retrycount'] === 0) return Promise.reject(err);

            options['retrycount'] -= 1;
            return Promise.delay(RetryTimeTable[Math.floor(Math.random()*RetryTimeTable.length)])
              .then(() => this.findOne(model, cond, fields, options));
          });
      });
  }
}