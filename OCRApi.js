var request = require('request');
module.exports = function getTextFromImg(senderID, attachments, callback) {
    var req = request.post('https://westus.api.cognitive.microsoft.com/luis/v2.0/apps/489d607e-e0a1-42e4-bc96-2fd9b4049318?subscription-key=77f9c9a858314f308245ec835d6d6091', function (err, resp, body) {
        if (err) {
            console.log('Error!');
        } else {
            console.log('URL: ' + body);
        }
        const text = attachments[0].payload;
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

