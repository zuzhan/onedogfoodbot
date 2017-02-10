var ApiParse = function() {
  this.ParseResponseText = function(req) {
      return JSON.parse(req.request.responseText);
  }
  this.ParseNotebooks = function(req) {
    return this.ParseResponseText(req).value;
  }
};
module.exports = new ApiParse();