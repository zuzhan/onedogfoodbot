var Utils = function() {
  this.ParseAuthCallbackUrl = function(req) {
    var res = {};
    res.senderId = req.query.sender_id;
    var hash = req.url.split('#')[1];
    res.hash = hash;
    var pairs = hash.split('&');
    pairs.forEach(function(pair) {
      var arr = pair.split('=');
      res[arr[0]] = arr[1];
    });
    return res;
  }
};
module.exports = new Utils();
