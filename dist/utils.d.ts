import * as mongoose from 'mongoose';
export declare class ObjectId {
    static str(timestamp: number, inc?: number): string;
    static get(timestamp: number, inc?: number): mongoose.Types.ObjectId;
}
