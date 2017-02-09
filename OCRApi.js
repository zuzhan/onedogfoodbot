var request = require('request');
module.exports = function getTextFromImg(senderID, attachment, callback) {
    var req = request.post(url, function (err, resp, body) {
        if (err) {
            console.log('Error!');
        } else {
            console.log('URL: ' + body);
        }
        const text = attachments.payload;
        callback(senderID, text);
    });
    // const form = req.form();
    // form.append('file', buffer, {
    //     filename: form,
    //     contentType: attachment, type
    // });
    // form.append();
    // return JSON.parse(res.getBody().toString());
}

