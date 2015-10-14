import * as mongoose from 'mongoose';

export class ObjectId {
  public static str(timestamp: number, inc: number = 0) {
    var time = Math.floor(timestamp / 1000).toString(16);
    var increment = inc.toString(16);
    return '00000000'.substr(0, 8 - time.length) + time +
           '0000000000' +
           '000000'.substr(0, 6 - increment.length) + increment;//);
  }

  public static get(timestamp: number, inc: number = 0) {
    return new mongoose.Types.ObjectId(this.str(timestamp, inc));
  }
}