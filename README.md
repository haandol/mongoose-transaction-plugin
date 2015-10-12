# mongoose-transaction-plugin
A mongoose plugin for transaction-like semantics between multiple documents.

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
