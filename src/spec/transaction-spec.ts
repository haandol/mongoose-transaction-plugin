import 'source-map-support/register'
import * as mongoose from 'mongoose';
import * as Bluebird from 'bluebird';
import * as _debug from 'debug';
import { plugin } from '../plugin';
import { Transaction } from '../transaction';

interface ITestPlayer extends mongoose.Document {
  name: string;
  age: number;
  money: number;
}

let debug = _debug('transaction:test');
let conn = mongoose.createConnection(process.env.MONGODB || 'mongodb://localhost');

console.log('MONGODB', process.env.MONGODB);

let testPlayerSchema = new mongoose.Schema({ name: String, age: Number, money: Number });
testPlayerSchema.plugin(plugin);
let TestPlayer = conn.model<ITestPlayer>('TestPlayer', testPlayerSchema);

describe('transaction', () => {
  beforeAll(done => {
    TestPlayer.collection.drop();
    Transaction.initialize(conn);
    let testPlayer1 = new TestPlayer({ name: 'ekim', age: 10, money: 0 });
    let testPlayer2 = new TestPlayer({ name: 'wokim', age: 50, money: 0 });
    return Bluebird.using(new Transaction().begin(), t => {
      t.insertDoc(testPlayer1);
      t.insertDoc(testPlayer2);
    }).then(() => done());
  });

  it('could use write lock', done => {
    Bluebird.resolve(TestPlayer.findOne({ name: 'ekim' }, { _id: 1 }).exec()).then(doc => {
      expect(doc['__t'] === undefined).not.toBeTruthy();
      debug('__t is %s', doc['__t']);
      debug('save document to detatch __t');
      return Bluebird.resolve(doc.save()).then(doc => {
        expect(doc['__t'] == undefined).toBeTruthy();
        done();
      });
    }).catch(err => done.fail(err));
  });

  it('could commit two documents in same transaction', done => {
    Bluebird.using(new Transaction().begin(), tx => {
      return Bluebird.props({
        testPlayer: tx.findOne(TestPlayer, { name: 'wokim' }),
      }).then((results:any) => {
        debug('locking success: %o', results.testPlayer);
        let testPlayer = <ITestPlayer>results.testPlayer;
        results.testPlayer.money += 600;
        return {test: 1};
      });
    }).then(results => {
      expect(results.test).toBe(1);
      done();
    }).catch(err => done.fail(err));
  });

  it('can not save without lock', done => {
    Bluebird.resolve(TestPlayer.findOne({name: 'ekim'}, {}, {force: true}).exec())
      .then(doc => {
        expect(doc['__t'] === undefined).toBeTruthy();
        // console.log('doc is ', doc);
        // console.log('save document to detatch __t');
        let save = Bluebird.promisify(doc.save);
        return save().then(result => {
          done.fail('FAIL! save without lock');
        }).catch(err => {
          // console.log('error for save() ', err);
          done();
        })
      });
  });

  it('duplicate findOne with One Transaction', done => {
    Bluebird.using(new Transaction().begin(), t => {
      return t.findOne(TestPlayer, {name: 'ekim'})
        .then((doc:any) => {
          expect(doc['__t'] === undefined).not.toBeTruthy();
          // console.log('first doc is ', doc);
          doc.money += 500;
          return t.findOne(TestPlayer, {name: 'ekim'})
            .then((doc:any) => {
              // console.log('second doc is ', doc);
              doc.money += 1000;
              return doc;
            });
        });
    })
      .then(result => {
        return Bluebird.resolve(TestPlayer.findOne({name: 'ekim'}, {}, {force: true}).exec())
      })
      .then(doc => {
        // console.log(doc.money);
        expect(doc.money).toBe(1500);
        done();
      })
      .catch(e => {
        console.error(e);
      });
  });

  it('duplicate findOne with other conditions', done => {
    Bluebird.using(new Transaction().begin(), t => {
      return t.findOne(TestPlayer, {name: 'ekim'})
        .then(doc => {
          expect(doc['__t'] === undefined).not.toBeTruthy();
          // console.log('first doc is ', doc);
          doc.money -= 500;
          return t.findOne(TestPlayer, {age: 10})
            .then(doc => {
              // console.log('second doc is ', doc);
              doc.money -= 1000;
              return doc;
            });
        });
    })
      .then(result => {
        return Bluebird.resolve(TestPlayer.findOne({name: 'ekim'}, {}, {force: true}).exec())
      })
      .then(doc => {
        expect(doc.money).toBe(0);
        done();
      });
  });

  xit('concurrency test(retry)', done => {
    function addMoney(name:string, money: number) {
      return Bluebird.using(new Transaction().begin(), t => {
        return t.findOne(TestPlayer, {name: name})
          .then(doc => {
            doc.money += money;
            console.log('addMoney!!!!! ', doc.money);
            return doc;
          });
      });
    }

    return Bluebird.all([
      addMoney('ekim', 100),
      addMoney('ekim', 100),
      addMoney('ekim', 100),
      addMoney('ekim', 100)
    ])
      .then((results) => {
        return Bluebird.resolve(TestPlayer.findOne({name: 'ekim'}, {}, {force: true}).exec())
      })
      .then(doc => {
        expect(doc.money).toBe(400);
        done();
      });
  });

  it('delete all document', done => {
    function removePlayerDoc(name: string) {
      return Bluebird.using(new Transaction().begin(), t => {
        return t.findOne(TestPlayer, {name: name})
          .then((doc:any) => {
            t.removeDoc(doc);
          });
        })
    }
    return Bluebird.all([removePlayerDoc('ekim'), removePlayerDoc('wokim')])
      .then(() => done());
  });
});
