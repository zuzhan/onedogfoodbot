request = require('request');

module.exports = function getIntention(text) {
    request({
        uri: 'https://westus.api.cognitive.microsoft.com/luis/v2.0/apps/489d607e-e0a1-42e4-bc96-2fd9b4049318?subscription-key=77f9c9a858314f308245ec835d6d6091&q='+ text +'&timezoneOffset=0.0&verbose=true',
        qs: {},
        method: 'GET'
    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            return body;
        } else {
            console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.errbodyor);
        }
    });
}