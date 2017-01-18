import * as Bluebird from 'bluebird';
import * as _debug from 'debug';
import { Transaction } from './transaction';

const debug = _debug('ISLAND:CTRL:TRANSACTION');

export function transactional(target, key, desc) {
  const originalMethod = desc.value;
  desc.value = function(...args: any[]) {
    debug('START @transactional');
    return Bluebird.using(new Transaction().begin(), t => {
      if (args[args.length] !== undefined) throw new Error('last parameter must be a Transaciton object.');
      args[args.length] = t;
      return originalMethod.apply(this, args);
    });
  };
}