var mongoose = require('mongoose');
var ObjectId = (function () {
    function ObjectId() {
    }
    ObjectId.str = function (timestamp, inc) {
        if (inc === void 0) { inc = 0; }
        var time = Math.floor(timestamp / 1000).toString(16);
        var increment = inc.toString(16);
        return '00000000'.substr(0, 8 - time.length) + time +
            '0000000000' +
            '000000'.substr(0, 6 - increment.length) + increment; //);
    };
    ObjectId.get = function (timestamp, inc) {
        if (inc === void 0) { inc = 0; }
        return new mongoose.Types.ObjectId(this.str(timestamp, inc));
    };
    return ObjectId;
})();
exports.ObjectId = ObjectId;
//# sourceMappingURL=utils.js.map