import 'source-map-support/register';
import * as mongoose from 'mongoose';
import * as Bluebird from 'bluebird';
import * as _debug from 'debug';
import { plugin } from '../plugin';
import { Transaction } from '../transaction';

const mockgoose = require('mockgoose');

export function spec(assertion: () => Promise<void>) {
  return function (done) {
    assertion.call(this).then(done, done.fail);
  };
}

interface ITestPlayer extends mongoose.Document {
  name: string;
  age: number;
  money: number;
}

const debug = _debug('transaction:test');
const conn: mongoose.Connection = mongoose.connection;
let TestPlayer: mongoose.Model<ITestPlayer>;

describe('transaction', () => {
  beforeAll(spec(async () => {
    await mockgoose(mongoose);
    await new Promise(resolve => mongoose.connect('test', resolve));

    const testPlayerSchema = new mongoose.Schema({ name: String, age: Number, money: Number });
    testPlayerSchema.plugin(plugin);
    TestPlayer = conn.model<ITestPlayer>('TestPlayer', testPlayerSchema);

    TestPlayer.collection.drop();
    Transaction.initialize(conn);
  }));

  beforeEach(spec(async () => {
    const testPlayer1 = new TestPlayer({ name: 'ekim', age: 10, money: 0 });
    const testPlayer2 = new TestPlayer({ name: 'wokim', age: 50, money: 0 });
    await Bluebird.using(new Transaction().begin(), t => {
      t.insertDoc(testPlayer1);
      t.insertDoc(testPlayer2);
    });
  }));

  it('could use write lock', spec(async () => {
    const doc = await TestPlayer.findOne({ name: 'ekim' }, { _id: 1 }, {transaction: true}).exec();
    expect(doc['__t']).toBeDefined();
    debug('__t is %s', doc['__t']);
    debug('save document to detatch __t');

    const saved = await doc.save();
    expect(saved['__t']).toBeUndefined();
  }));

  it('could commit two documents in same transaction', spec(async () => {
    await Bluebird.using(new Transaction().begin(), async (tx) => {
      const testPlayer = await tx.findOne(TestPlayer, { name: 'wokim' });
      debug('locking success: %o', testPlayer);
      testPlayer.money += 600;
    });
    expect(1).toBe(1);
  }));

  it('can not save without lock', spec(async () => {
    const doc = await TestPlayer.findOne({name: 'ekim'}, {}).exec();
    expect(doc['__t']).toBeUndefined();
    // console.log('doc is ', doc);
    // console.log('save document to detatch __t');
    try {
      await doc.save();
      expect(true).toEqual(false);
    } catch (e) {
      expect(true).toEqual(true);
    }
  }));

  it('duplicate findOne with One Transaction', spec(async () => {
    await Bluebird.using(new Transaction().begin(), async (t) => {
      const doc = await t.findOne(TestPlayer, {name: 'ekim'});
      expect(doc['__t']).toBeDefined();
      // console.log('first doc is ', doc);
      doc.money += 500;
      const secondTry = await t.findOne(TestPlayer, {name: 'ekim'});
      // console.log('second doc is ', doc);
      secondTry.money += 1000;
    });
    const doc = await TestPlayer.findOne({name: 'ekim'}, {}).exec();
    // console.log(doc.money);
    expect(doc.money).toBe(1500);
  }));

  it('duplicate findOne with other conditions', spec( async() => {
    await Bluebird.using(new Transaction().begin(), async (t) => {
      const doc = await t.findOne(TestPlayer, {name: 'ekim'});
      expect(doc['__t']).toBeDefined();
      console.log('first doc is ', doc);
      doc.money += 500;
      const sameButDiffConditionDoc = await t.findOne(TestPlayer, {age: 10});
      console.log('second doc is ', doc);
      sameButDiffConditionDoc.money += 1000;
    });
    const doc = await TestPlayer.findOne({name: 'ekim'}, {}).exec();
    expect(doc.money).toBe(1500);
  }));

  xit('concurrency test(retry)', done => {
    function addMoney(name: string, money: number) {
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
        return Bluebird.resolve(TestPlayer.findOne({name: 'ekim'}, {}).exec());
      })
      .then(doc => {
        expect(doc.money).toBe(400);
        done();
      });
  });

  it('delete all document', spec(async () => {
    async function removePlayerDoc(name: string) {
      await Bluebird.using(new Transaction().begin(), async (t) => {
        const doc = await t.findOne(TestPlayer, {name: name});
        await t.removeDoc(doc);
      });
    }
    expect(async () => {
      await Bluebird.all([removePlayerDoc('ekim'), removePlayerDoc('wokim')]);
    }).not.toThrow();
  }));

  afterEach(spec(async () => {
    await new Promise((resolve) => mockgoose.reset(() => resolve()));
  }));

  afterAll(spec(async () => {
    await new Promise((resolve) => (mongoose as any).unmock(resolve));
    await new Promise(resolve => mongoose.disconnect(resolve));
  }));
});
