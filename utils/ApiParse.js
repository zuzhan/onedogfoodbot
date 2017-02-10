var ApiParse = function() {
  this.ParseNotebooks = function(req) {
    return req.request.responseText.value;
  }
};
module.exports = new ApiParse();