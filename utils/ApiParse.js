var ApiParse = function() {
  this.ParseResponseText = function(req) {
      return JSON.parse(req.request.responseText);
  }

  this.ParseNotebooks = function(req) {
      return this.ParseResponseText(req).value;
  }

  this.ParsePages = function(req) {
      return this.ParseResponseText(req).value;
  }

  this.ParsePage = function(req) {
      return this.ParseResponseText(req);
  }

  this.ParsePageContent = function(req) {
      return req.request.responseText;
  }

  this.ParseSections = function(req) {
      return this.ParseResponseText(req).value;
  }

  this.ParseGetPagesBatch = function(req) {
      var responseText = req.request.responseText;
      console.log(responseText);
  }
};
module.exports = new ApiParse();