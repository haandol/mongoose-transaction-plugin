import * as Promise from 'bluebird';
import * as _debug from 'debug';
import * as _ from 'lodash';
import { Transaction } from './transaction';

let debug = _debug('ISLAND:CTRL:TRANSACTION');

export function transactional(target, key, desc) {
  var originalMethod = desc.value;
  desc.value = function(...args: any[]) {
    debug('START @transactional');
    return Promise.using<any, Transaction>(new Transaction().begin(), t => {
      if (args[args.length] !== undefined) throw new Error('last parameter must be a Transaciton object.');
      args[args.length] = t;
      return originalMethod.apply(this, args);
    });
  };
}