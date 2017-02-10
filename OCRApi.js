var request = require('request');

module.exports = function getTextFromImg(senderID, attachments, callback) {
    var options = {
        url: 'https://westus.api.cognitive.microsoft.com/vision/v1.0/ocr?language=unk&detectOrientation=true',
        method: 'POST',
        body: attachments[0].payload,
        json: true,
        headers: {
            'Ocp-Apim-Subscription-Key': '416a207c033b4e91abc5c3fc24cdc2db'
        }
    };

    var req = request.post(
        options,
        function (err, resp, body) {
            if (err) {
                console.log('Error!');
            } else {
                console.log('URL: ' + body);
            }
            callback(senderID, resp.body.toString());
            var res = '';
            resp.body.regions.forEach(
                function (region) {
                    region.lines.forEach(
                        function(line){
                            line.words.forEach(
                                function(word){
                                    res+= word.text+ ' ';
                                }
                            )
                        }
                    );

                }
            );
            // const text = attachments[0].payload.url;
            callback(senderID, res);
        });
}
