require('source-map-support/register');
var mongoose = require('mongoose');
var Promise = require('bluebird');
var _debug = require('debug');
var plugin_1 = require('../plugin');
var transaction_1 = require('../transaction');
var debug = _debug('transaction:test');
var conn = mongoose.createConnection(process.env.MONGODB || 'mongodb://192.168.99.100');
var testPlayerSchema = new mongoose.Schema({ name: String, age: Number, money: Number });
testPlayerSchema.plugin(plugin_1.plugin);
var TestPlayer = conn.model('TestPlayer', testPlayerSchema);
describe('transaction', function () {
    beforeAll(function (done) {
        transaction_1.Transaction.initialize(conn);
        var testPlayer1 = new TestPlayer({ name: 'ekim', age: 10, money: 0 });
        var testPlayer2 = new TestPlayer({ name: 'wokim', age: 50, money: 0 });
        return Promise.using(new transaction_1.Transaction().begin(), function (t) {
            t.insertDoc(testPlayer1);
            t.insertDoc(testPlayer2);
        }).then(function () { return done(); });
    });
    xit('could use write lock', function (done) {
        Promise.resolve(TestPlayer.findOne({ name: 'ekim' }, { _id: 1 }).exec()).then(function (doc) {
            expect(doc['__t'] === undefined).not.toBeTruthy();
            debug('__t is %s', doc['__t']);
            debug('save document to detatch __t');
            return Promise.resolve(doc.save()).then(function (doc) {
                expect(doc['__t'] == undefined).toBeTruthy();
                done();
            });
        }).catch(function (err) { return done.fail(err); });
    });
    xit('could commit two documents in same transaction', function (done) {
        Promise.using(new transaction_1.Transaction().begin(), function (tx) {
            return Promise.props({
                testPlayer: tx.findOne(TestPlayer, { name: 'wokim' }, {}),
            }).then(function (results) {
                debug('locking success: %o', results.testPlayer);
                var testPlayer = results.testPlayer;
                results.testPlayer.money += 600;
                return { test: 1 };
            });
        }).then(function (results) {
            expect(results.test).toBe(1);
            done();
        }).catch(function (err) { return done.fail(err); });
    });
    it('can not save without lock', function (done) {
        Promise.resolve(TestPlayer.findOne({ name: 'ekim' }, {}, { force: true }).exec())
            .then(function (doc) {
            expect(doc['__t'] === undefined).toBeTruthy();
            console.log('doc is ', doc);
            console.log('save document to detatch __t');
            var save = Promise.promisify(doc.save);
            return save().then(function (result) {
                done.fail('FAIL! save without lock');
            }).catch(function (err) {
                console.log('error for save() ', err);
                done();
            });
        });
    });
    it('duplicate findOne with One Transaction', function (done) {
        Promise.using(new transaction_1.Transaction().begin(), function (t) {
            return t.findOne(TestPlayer, { name: 'ekim' })
                .then(function (doc) {
                expect(doc['__t'] === undefined).not.toBeTruthy();
                console.log('first doc is ', doc);
                doc.money += 500;
                return t.findOne(TestPlayer, { name: 'ekim' })
                    .then(function (doc) {
                    console.log('second doc is ', doc);
                    doc.money += 1000;
                    return doc;
                });
            });
        })
            .then(function (result) {
            return Promise.resolve(TestPlayer.findOne({ name: 'ekim' }, {}, { force: true }).exec());
        })
            .then(function (doc) {
            expect(doc.money).toBe(1500);
            done();
        });
    });
    it('duplicate findOne with other conditions', function (done) {
        Promise.using(new transaction_1.Transaction().begin(), function (t) {
            return t.findOne(TestPlayer, { name: 'ekim' })
                .then(function (doc) {
                expect(doc['__t'] === undefined).not.toBeTruthy();
                console.log('first doc is ', doc);
                doc.money -= 500;
                return t.findOne(TestPlayer, { age: 10 })
                    .then(function (doc) {
                    console.log('second doc is ', doc);
                    doc.money -= 1000;
                    return doc;
                });
            });
        })
            .then(function (result) {
            return Promise.resolve(TestPlayer.findOne({ name: 'ekim' }, {}, { force: true }).exec());
        })
            .then(function (doc) {
            expect(doc.money).toBe(0);
            done();
        });
    });
    it('concurrency test(retry)', function (done) {
        function addMoney(name, money) {
            return Promise.using(new transaction_1.Transaction().begin(), function (t) {
                return t.findOne(TestPlayer, { name: name })
                    .then(function (doc) {
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
            .then(function (results) {
            return Promise.resolve(TestPlayer.findOne({ name: 'ekim' }, {}, { force: true }).exec());
        })
            .then(function (doc) {
            expect(doc.money).toBe(400);
            done();
        });
    });
    it('delete all document', function (done) {
        function removePlayerDoc(name) {
            return Promise.using(new transaction_1.Transaction().begin(), function (t) {
                return t.findOne(TestPlayer, { name: name })
                    .then(function (doc) {
                    t.removeDoc(doc);
                });
            });
        }
        return Promise.all([removePlayerDoc('ekim'), removePlayerDoc('wokim')])
            .then(function () { return done(); });
    });
});
//# sourceMappingURL=transaction-spec.js.map