import * as mongoose from 'mongoose';
import * as _debug from 'debug';
import * as Promise from 'bluebird';
import { Transaction } from './transaction';
import { TransactionError, TransactionErrors } from './error';
import { ObjectId } from './utils';

let debug = _debug('transaction');

export interface TxDocument extends mongoose.Document {
  __t?: mongoose.Types.ObjectId;
  //__new?: boolean;
}

export function plugin(schema: mongoose.Schema, options?: Object) {
  schema.add({
    __t: { type: mongoose.Schema.Types.ObjectId },
    //__new: { type: Boolean, default: true }
  });

  schema.pre('save', function(next) {
    debug('pre-save');
    debug('checking __t field: ', this.__t);
    if (!this.__t) return next(new Error('You can\' not save without lock'));

    // TODO:
    // if (this.__t.toString().substring(8, 18) !== '0000000000') return next(new Error(''));
    this.__t = undefined;
    next();
  });

  schema.pre('findOne', function(next) {
    if (this.options.force) return next();
    debug('pre-findOne');
    debug('options: %o', this.options);

    debug('conditions: %o', this._conditions);

    return Promise.resolve(this.model.findOne(this._conditions, {_id: 1, __t: 1}, {force: true}).exec())
      .then(doc => {
        if (!doc) return next();
        let tDisplace = false;
        debug('document found! t : ', doc.__t, ', id : ', doc.id);

        return Promise.try(() => {
            if (doc.__t) {
              // multiple findOne in a single transaction.
              if (this.options.__t && this.options.__t.equals(doc.__t)) {
                debug('already locked: ', doc.__t);
                return next();
              }

              let tModel = this.options.tModel;
              debug('tModel is ', tModel);
              let docTime = doc.__t.getTimestamp();
              let current = new Date().getTime();
              debug('timestamp! ', docTime, current, current - docTime);

              if (current - docTime >= 30000) {
                // find Transaction

                return Promise.resolve(tModel.findOne({_id: doc.__t}).exec())
                  .then((t: any) => {
                    debug('find Transaction ', t, t.state);
                    if (!t) return next(new Error('There is no transaction history.'));
                    switch (t.state) {
                      case 'init':
                        // cancel
                        debug('cancel transaction');
                        tDisplace = true;
                        tModel.update({_id: doc.__t}, {state: 'canceled'}, {w:1}).exec();
                        break;
                      case 'pending':
                        // recommit
                        debug('recommit transaction');
                        return Transaction.recommit(t)
                          .then(() => tModel.update({_id: doc.__t}, {state: 'committed'}, {w:1}).exec());
                      case 'committed':
                        debug('already committed. ignore __t');
                        tDisplace = true;
                        break;
                    }
                  });
              }
            }
          })
          .then(() => {
            this._conditions['_id'] = doc._id;
            if (!tDisplace) this._conditions['__t'] = {'$exists': false};
            debug('conditions are modified', this._conditions);
            var update = {__t: this.options.__t || ObjectId.get(Date.now())};
            debug('update query is modified %o', update);

            return Promise.resolve(this.model.update(this._conditions, update, {
              force: true,
              w: 1
            }).exec()).then((rawResponse) => {
              debug('rawResponse: %o', rawResponse);
              if (rawResponse.n > 0 && rawResponse.nModified > 0 && rawResponse.n === rawResponse.nModified) {
                debug('locking success');
                delete this._conditions['__t'];
                debug('rollback conditions', this._conditions);
                if (this._fields) this._fields['__t'] = 1;
                return next();
              }
              return next('write lock');
            });
          }).catch(next);
      });
  });
}