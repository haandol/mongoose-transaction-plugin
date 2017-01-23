# mongoose-transaction-plugin
A mongoose plugin for transaction-like semantics between multiple documents.

[![Build Status](https://api.travis-ci.org/spearhead-ea/mongoose-transaction-plugin.svg?branch=master)](https://travis-ci.org/spearhead-ea/mongoose-transaction-plugin)
[![NPM version](https://badge.fury.io/js/mongoose-transaction-plugin.svg)](http://badge.fury.io/js/mongoose-transaction-plugin)
[![Dependency Status](https://david-dm.org/spearhead-ea/mongoose-transaction-plugin/status.svg)](https://david-dm.org/spearhead-ea/mongoose-transaction-plugin)
[![Coverage Status](https://coveralls.io/repos/github/spearhead-ea/mongoose-transaction-plugin/badge.svg?branch=master)](https://coveralls.io/github/spearhead-ea/mongoose-transaction-plugin?branch=master)

## Example
```typescript
let conn = mongoose.createConnection(process.env.MONGODB || 'mongodb://192.168.99.100:27017');
let transaction = new Transaction(conn);
transaction.begin().then(() => {
  return Promise.props({
    testPlayer: transaction.findOne(TestPlayer, { name: 'wokim' }, { _id: 1, name: 1 }),
    testData: transaction.findOne(TestData, { money: { '$eq' : 500 } })
  });
}).then(results => {
  let testPlayer = <ITestPlayer>results.testPlayer;
  let testData = <ITestData>results.testData;

  testPlayer.name = 'wokim2';
  testData.money += 600;

  return transaction.commit();
}).then(() => {
  done();
}).catch(err => done.fail(err));
```
