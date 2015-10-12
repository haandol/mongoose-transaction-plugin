/// <reference path="../../typings/tsd.d.ts" />
import 'source-map-support/register'
import * as mongoose from 'mongoose';
import * as Promise from 'bluebird';
import * as _debug from 'debug';
import { plugin, Transaction } from '../index';

interface ITestPlayer extends mongoose.Document {
  name: string;
}

interface ITestData extends mongoose.Document {
  money: number;
}

let debug = _debug('transaction:test');
let conn = mongoose.createConnection(process.env.MONGODB || 'mongodb://192.168.99.100');

let testPlayerSchema = new mongoose.Schema({ name: String });
testPlayerSchema.plugin(plugin);
let TestPlayer = conn.model<ITestPlayer>('TestPlayer', testPlayerSchema);

let testDataSchema = new mongoose.Schema({ money: Number });
testDataSchema.plugin(plugin);
var TestData = conn.model<ITestData>('TestData', testDataSchema);

describe('transaction' ,() => {
  beforeAll(done => {
    let testPlayer1 = new TestPlayer({ name: 'name' });
    let testData1 = new TestData({ money: 0 });
    let testPlayer2 = new TestPlayer({ name: 'wokim' });
    let testData2 = new TestData({ money: 500 });
    return Promise.all([testPlayer1.save(), testData1.save(), testPlayer2.save(), testData2.save()]).then(() => done());
  });

  it('could use write lock', done => {
    Promise.resolve(TestPlayer.findOne({ name: 'name' }, { _id: 1 }).exec()).then(doc => {
      expect(doc['__t'] === undefined).not.toBeTruthy();
      debug('__t is %s', doc['__t']);
      debug('save document to detatch __t');
      return Promise.resolve(doc.save()).then(doc => {
        expect(doc['__t'] == undefined).toBeTruthy();
        done();
      });
    }).catch(err => done.fail(err));
  });

  it('could commit two documents in same transaction', done => {
    let transaction = new Transaction(conn);
    transaction.begin().then(() => {
      return Promise.props({
        testPlayer: transaction.findOne(TestPlayer, { name: 'wokim' }, { _id: 1, name: 1 }),
        testData: transaction.findOne(TestData, { money: { '$eq' : 500 } })
      });
    }).then((results:any) => {
      debug('locking success: %o', results.testPlayer);
      debug('locking success: %o', results.testData);
      let testPlayer = <ITestPlayer>results.testPlayer;
      let testData = <ITestData>results.testData;

      testPlayer.name = 'wokim2';
      testData.money += 600;

      return transaction.commit();
    }).then(() => {
      done();
    }).catch(err => done.fail(err));
  });
});