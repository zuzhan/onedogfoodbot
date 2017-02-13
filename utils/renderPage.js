const fs = require('fs');

var jsdom = require("jsdom").jsdom;
var serializeDocument = require("jsdom").serializeDocument;

var pageWrap = fs.readFileSync('./page.html', 'utf8');


module.exports = function renderPage(pageContent) {
    var wrapDoc = jsdom(pageWrap);
    var pageDoc = jsdom(pageContent);
    var body = pageDoc.body;
    var noteWrap = wrapDoc.getElementById('noteWrap');
    noteWrap.innerHTML = body.innerHTML;
    wrapDoc.title = pageDoc.title;
    return serializeDocument(wrapDoc);
}
