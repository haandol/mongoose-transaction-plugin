import * as mongoose from 'mongoose';
import * as _ from 'lodash';
import * as Bluebird from 'bluebird';
import * as _debug from 'debug';
import * as events from 'events';

const debug = _debug('transaction');
const RETRYCOUNT = 5;
const RetryTimeTable = [197, 173, 181, 149, 202];
const TRANSACTION_KEEP_COMMITTED = (process.env.TRANSACTION_KEEP_COMMITTED === 'true' || false);

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
  id: string;
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

    const historySchema = new mongoose.Schema({
      col: { type: String, required: true },
      oid: { type: mongoose.Schema.Types.ObjectId, required: true },
      op: { type: String, required: true },
      query: { type: String, required: true }
    });

    const transactionSchema = new mongoose.Schema({
      history: [historySchema],
      state: { type: String, required: true, default: 'init', index: true }
    });
    this.connection = connection;
    this.model = connection.model<ITransaction>('Transaction', transactionSchema);
  }

  public begin() {
    return Bluebird.try(async () => {
      if (!Transaction.model) throw new Error('Not initialized exception');
      if (this.transaction) throw new Error('Transaction has already been started');

      const transaction = new Transaction.model();
      // TODO: should be fixed mongoose.d.ts
      this.transaction = await transaction.save();
      debug('transaction created: %o', this.transaction);
      return this;
    }).catch((e: Error) => {
      // TODO we should handle every exception correctly in here,
      // otherwise the uncaught exception will make the process down.
      // Ref. http://bluebirdjs.com/docs/api/disposer.html#note-about-disposers-in-node

      // ## Possible exceptions
      // - Error('Not initialized exception')
      // - Error('Transaction has already been started')
      // - A potential error from transaction.save
      if (e.message === 'Transaction has already been started') return;

      throw e;
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

  static scope<R>(doInTransactionScope: (t: Transaction) => Bluebird<R> | Promise<R>): Bluebird<R> | Promise<R> {
    return Bluebird.using<Transaction, R>(new Transaction().begin(), doInTransactionScope);
  }

  public get _id(): mongoose.Types.ObjectId {
    return this.transaction._id;
  }

  public async cancel(): Promise<void> {
    if (!this.transaction) return;
    if (this.transaction.state && this.transaction.state !== 'init') return;

    await this.transaction.remove();
    try {
      await Bluebird.each(this.participants, async (participant) => {
        if (participant.doc.isNew) return participant.doc['__t'] = undefined;
        return await participant.doc.update({$unset: {__t: ''}}, { w: 1 }, undefined).exec();
      });
    } catch (e) {
      debug('[warning] removing __t has been failed');
    }

    this.transaction = undefined;
    this.participants = [];
  }

  private static async commitHistory(history: IHistory): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      return this.connection.db.collection(history.col, function(err, collection) {
        if (err) {
          debug('Can not find collection: ', err);
          return resolve();
        }
        const query = JSON.parse(history.query);
        query['$unset'] = query['$unset'] || {};
        query['$unset']['__t'] = '';
        debug('update recommit query is : ', query);
        return collection.findOneAndUpdate({_id: history.oid}, query, function(err, doc) {
          debug('updated document ', doc);
          return resolve();
        });
      });
    });
  }

  public static async recommit(transaction: ITransaction): Promise<void> {
    const histories = transaction.history;
    if (!histories) return;

    await Bluebird.each(histories, async (history) => {
      debug('find history collection: ', history.col, ' oid: ', history.oid);
      await Transaction.commitHistory(history);
    });
    debug('transaction recommited!');
  }

  private static async validate(doc: any): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      return doc.validate(err => err && reject(err) || resolve());
    });
  }

  public async commit(): Promise<void> {
    if (!this.transaction) return;

    await Bluebird.each(this.participants, async (participant) => {
      // TODO: should be fixed mongoose.d.ts
      await Transaction.validate(participant.doc);

      debug('delta: %o', (<any>participant.doc).$__delta());
      // TODO: 쿼리 제대로 만들기
      let query: string;
      if (participant.op === 'update') {
        query = JSON.stringify(((<any>participant.doc).$__delta() || [null, {}])[1]);
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
    debug('history generated: %o', this.transaction.history);

    this.transaction.state = 'pending';
    try {
      this.transaction = await this.transaction.save();
    } catch (err) {
      this.transaction.state = 'init';
      throw err;
    }

    debug('apply participants\' changes');
    try {
      await Bluebird.map(this.participants, async (participant) => {
        if (participant.op === 'remove') return await participant.doc.remove();
        else return await participant.doc.save();
      });

      debug('transaction committed');
      // TRANSACTION_KEEP_COMMITTED 값에 따라 Transaction Document를 지우거나 갱신한다.
      if (!(TRANSACTION_KEEP_COMMITTED)) {
        await this.transaction.remove();        
      } else {
        this.transaction.state = 'committed';
        await this.transaction.save();        
      }
    } catch (err) {
      // 하나라도 실패하면 pending 상태로 recommit 처리된다.
      debug('Fails to save whole transactions but they will be saved', err);
    }

    this.transaction = undefined;
    this.participants = [];
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

    const id: mongoose.Types.ObjectId = doc['__t'];
    if (!id || id.toHexString() !== this.transaction.id) throw new Error('락이 이상함');
    this.participants.push({ op: 'remove', doc: doc });
  }

  public async findOne<T extends mongoose.Document>(model: mongoose.Model<T>, cond: Object, fields?: Object, options?: Object): Promise<T> {
    if (!this.transaction) throw new Error('Could not find any transaction');

    const p = _.find(this.participants, p => {
      return p.model === model && JSON.stringify(cond) === JSON.stringify(p.cond);
    });
    if (p && p.doc) return p.doc as T;

    if (!options) options = { retrycount: RETRYCOUNT };
    if (options['retrycount'] === undefined) {
      debug('set retrycount ', options, options['retrycount']);
      options['retrycount'] = RETRYCOUNT;
    }

    const opt = _.cloneDeep(options || {});
    opt['__t'] = this.transaction._id;
    opt['tModel'] = Transaction.getModel;
    opt['transaction'] = true;

    debug('tModel before ', opt['tModel'].collection.name);

    debug('attempt write lock', _.omit(opt, 'tModel'));
    let doc: T;
    try {
      doc = await model.findOne(cond, fields, opt).exec();
    } catch (err) {
      debug('transaction err : retrycount is ', options['retrycount']);
      if (err.message !== 'write lock' || options['retrycount'] === 0) throw err;

      options['retrycount'] -= 1;
      await Bluebird.delay(RetryTimeTable[Math.floor(Math.random() * RetryTimeTable.length)]);
      return await this.findOne(model, cond, fields, options);
    }
    if (!doc) return;

    const withSameId = _.find(this.participants, p => {
      return p.model === model && p.doc._id.equals(doc._id);
    });
    if (withSameId) return withSameId.doc as T;

    this.participants.push({op: 'update', doc: doc, model: model, cond: cond});
    return doc;
  }
}
