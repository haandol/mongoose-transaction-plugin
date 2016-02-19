import * as mongoose from 'mongoose';
import * as Promise from 'bluebird';
import * as events from 'events';
export declare class Transaction extends events.EventEmitter {
    static TRANSACTION_EXPIRE_THRESHOLD: number;
    private static model;
    private transaction;
    private participants;
    static initialize(connection: mongoose.Connection): void;
    begin(): Promise.Disposer<this>;
    cancel(): Promise<void>;
    commit(): Promise<void>;
    insertDoc(doc: mongoose.Document): void;
    removeDoc(doc: mongoose.Document): void;
    findOne<T extends mongoose.Document>(model: mongoose.Model<T>, cond: Object, fields?: Object, options?: Object): Promise<T>;
}
