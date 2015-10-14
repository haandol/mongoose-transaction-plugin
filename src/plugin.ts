import * as mongoose from 'mongoose';
import * as _debug from 'debug';
import * as Promise from 'bluebird';
import { TransactionError, TransactionErrors } from './error';
import { ObjectId } from './utils';

let debug = _debug('transaction:plugin');

export interface TxDocument extends mongoose.Document {
  __t?: mongoose.Types.ObjectId;
  //__new?: boolean;
}

export function plugin(schema: mongoose.Schema, options?: Object) {
  schema.add({
    __t: { type: mongoose.Schema.Types.ObjectId },
    //__new: { type: Boolean, default: true }
  })

  schema.pre('save', function(next) {
    debug('pre-save');
    debug('checking __t field: ', this.__t);
    if (!this.__t) return next(new TransactionError(0));

    // TODO:
    // if (this.__t.toString().substring(8, 18) !== '0000000000') return next(new Error(''));
    this.__t = undefined;
    next();
  });

  schema.pre('findOne', function(next) {
    debug('pre-findOne');
    debug('options: %o', this.options);
    if (this.options.force) return next();

    debug('conditions: %o', this._conditions);
    return Promise.resolve(this.model.findOne(this._conditions, { _id: 1, __t: 1 }, { force: true }).exec()).then(doc => {
      if (!doc) return next();

      debug('document found: %s', doc.id);
      // TODO: transaction recommit
      if (doc.__t) {

      }

      this._conditions['_id'] = doc._id;
      this._conditions['__t'] = { '$exists': false };
      debug('conditions are modified', this._conditions);
      var update = { __t: this.options.__t || ObjectId.get(Date.now()) };
      debug('update query is modified %o', update);

      // NOTE: write concern
      // http://docs.mongodb.org/manual/core/write-concern/
      return Promise.resolve(this.model.update(this._conditions, update, { force: true, w: 1 }).exec()).then((rawResponse) => {
        debug('rawResponse: %o', rawResponse);
        if (rawResponse.n > 0 && rawResponse.nModified > 0 && rawResponse.n === rawResponse.nModified) {
          debug('locking success');
          delete this._conditions['__t'];
          debug('rollback conditions', this._conditions);
          if (this._fields) this._fields['__t'] = 1;
          return next();
        }
        throw new Error('write lock');
      });
    }).catch(next);
  });
}