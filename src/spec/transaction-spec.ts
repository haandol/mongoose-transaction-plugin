import 'source-map-support/register'
import * as mongoose from 'mongoose';
import * as Promise from 'bluebird';
import * as _debug from 'debug';
import { plugin } from '../plugin';
import { Transaction } from '../transaction';

interface ITestPlayer extends mongoose.Document {
  name: string;
  age: number;
  money: number;
}

let debug = _debug('transaction:test');
let conn = mongoose.createConnection(process.env.MONGODB || 'mongodb://192.168.99.100');

let testPlayerSchema = new mongoose.Schema({ name: String, age: Number, money: Number });
testPlayerSchema.plugin(plugin);
let TestPlayer = conn.model<ITestPlayer>('TestPlayer', testPlayerSchema);

describe('transaction' ,() => {
  beforeAll(done => {
    Transaction.initialize(conn);
    let testPlayer1 = new TestPlayer({ name: 'ekim', age: 10, money: 0 });
    let testPlayer2 = new TestPlayer({ name: 'wokim', age: 50, money: 0 });
    return Promise.using<any, Transaction>(new Transaction().begin(), t => {
      t.insertDoc(testPlayer1);
      t.insertDoc(testPlayer2);
    }).then(() => done());
  });

  xit('could use write lock', done => {
    Promise.resolve(TestPlayer.findOne({ name: 'ekim' }, { _id: 1 }).exec()).then(doc => {
      expect(doc['__t'] === undefined).not.toBeTruthy();
      debug('__t is %s', doc['__t']);
      debug('save document to detatch __t');
      return Promise.resolve(doc.save()).then(doc => {
        expect(doc['__t'] == undefined).toBeTruthy();
        done();
      });
    }).catch(err => done.fail(err));
  });

  xit('could commit two documents in same transaction', done => {
    Promise.using<{test: number}, Transaction>(new Transaction().begin(), tx => {
      return Promise.props({
        testPlayer: tx.findOne(TestPlayer, { name: 'wokim' }, {}),
      }).then((results:any) => {
        debug('locking success: %o', results.testPlayer);
        let testPlayer = <ITestPlayer>results.testPlayer;
        results.testPlayer.money += 600;
        return {test: 1};
      });
    }).then(results => {
      expect(results.test).toBe(1);
      done()
    }).catch(err => done.fail(err));
  });

  it('can not save without lock', done => {
    Promise.resolve(TestPlayer.findOne({name: 'ekim'}, {}, {force: true}).exec())
      .then(doc => {
        expect(doc['__t'] === undefined).toBeTruthy();
        console.log('doc is ', doc);
        console.log('save document to detatch __t');
        let save = Promise.promisify(doc.save);
        return save().then(result => {
          done.fail('FAIL! save without lock');
        }).catch(err => {
          console.log('error for save() ', err);
          done();
        })
      });
  });

  it('duplicate findOne with One Transaction', done => {
    Promise.using<any, Transaction>(new Transaction().begin(), t => {
      return t.findOne(TestPlayer, {name: 'ekim'})
        .then((doc:any) => {
          expect(doc['__t'] === undefined).not.toBeTruthy();
          console.log('first doc is ', doc);
          doc.money += 500;
          return t.findOne(TestPlayer, {name: 'ekim'})
            .then((doc:any) => {
              console.log('second doc is ', doc);
              doc.money += 1000;
              return doc;
            });
        });
    })
      .then(result => {
        return Promise.resolve(TestPlayer.findOne({name: 'ekim'}, {}, {force: true}).exec())
      })
      .then(doc => {
        expect(doc.money).toBe(1500);
        done();
      });
  });

  it('duplicate findOne with other conditions', done => {
    Promise.using<any, Transaction>(new Transaction().begin(), t => {
      return t.findOne(TestPlayer, {name: 'ekim'})
        .then(doc => {
          expect(doc['__t'] === undefined).not.toBeTruthy();
          console.log('first doc is ', doc);
          doc.money -= 500;
          return t.findOne(TestPlayer, {age: 10})
            .then(doc => {
              console.log('second doc is ', doc);
              doc.money -= 1000;
              return doc;
            });
        });
    })
      .then(result => {
        return Promise.resolve(TestPlayer.findOne({name: 'ekim'}, {}, {force: true}).exec())
      })
      .then(doc => {
        expect(doc.money).toBe(0);
        done();
      });
  });

  it('concurrency test(retry)', done => {
    function addMoney(name:string, money: number) {
      return Promise.using<any, Transaction>(new Transaction().begin(), t => {
        return t.findOne(TestPlayer, {name: name})
          .then(doc => {
            doc.money += money;
            console.log('addMoney!!!!! ', doc.money);
            return doc;
          });
      });
    }

    return Promise.all([
      addMoney('ekim', 100),
      addMoney('ekim', 100),
      addMoney('ekim', 100),
      addMoney('ekim', 100)
    ])
      .then((results) => {
        return Promise.resolve(TestPlayer.findOne({name: 'ekim'}, {}, {force: true}).exec())
      })
      .then(doc => {
        expect(doc.money).toBe(400);
        done();
      });
  });

  it('delete all document', done => {
    function removePlayerDoc(name: string) {
      return Promise.using<any, Transaction>(new Transaction().begin(), t => {
        return t.findOne(TestPlayer, {name: name})
          .then((doc:any) => {
            t.removeDoc(doc);
          });
        })
    }
    return Promise.all([removePlayerDoc('ekim'), removePlayerDoc('wokim')])
      .then(() => done());
  });
});