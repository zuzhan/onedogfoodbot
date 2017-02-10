var ApiParse = function() {
  this.ParseNotebooks = function(req) {
      console.log(JSON.stringify(req));
      console.log(JSON.stringify(req.request));
      console.log(JSON.stringify(req.request.responseText));
      console.log(JSON.stringify(req.request.responseText.value));
    return req.request.responseText.value;
  }
};
module.exports = new ApiParse();