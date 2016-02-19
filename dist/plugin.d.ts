import * as mongoose from 'mongoose';
export interface TxDocument extends mongoose.Document {
    __t?: mongoose.Types.ObjectId;
}
export declare function plugin(schema: mongoose.Schema, options?: Object): void;
