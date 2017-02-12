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
      var reg = /Preference-Applied: odata\.include-annotations=\*([\s\S]*?)--batchresponse/g;
      var pages = [];
      var temp = reg.exec(responseText);
      while (temp) {
          page = JSON.parse(temp[1]);
          pages.push(page);
          temp = reg.exec(responseText);
      }
      return pages;
  }
};
module.exports = new ApiParse();