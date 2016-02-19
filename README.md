# mongoose-transaction-plugin
A mongoose plugin for transaction-like semantics between multiple documents.

## Install
```shell
npm install mongoose-transaction-plugin
```

## Build
```shell
npm run build
```

## Test
```shell
export MONGODB=mongodb://<ip>:<port>
npm test
```

## Example
```typescript
import { Transaction } from 'mongoose-transaction-plugin';
let conn = mongoose.createConnection(process.env.MONGODB || 'mongodb://192.168.99.100:27017');

Promise.using<any, Transaction>(new Transaction(conn).begin(), t => {
  return Promise.props({
    testPlayer: t.findOne(TestPlayer, { name: 'wokim' }, { _id: 1, name: 1 }),
    testData: t.findOne(TestData, { money: { '$eq' : 500 } })
  }).then(results => {
    let testPlayer = <ITestPlayer>results.testPlayer;
    let testData = <ITestData>results.testData;
  
    testPlayer.name = 'wokim2';
    testData.money += 600;
  });
}).catch(console.err);
```
