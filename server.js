/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

const
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),
  request = require('request');
const getIntention = require('./LuisAPI');

const getTextFromImg = require('./OCRApi');

const renderPage = require('./utils/renderPage.js');
var async = require('asyncawait/async');
var await = require('asyncawait/await');

var app = express();
var liveConnect = require('./lib/liveconnect-client');
var createExamples = require('./lib/create-examples');
var onenoteapi = require('./lib/oneNoteApi');
var Token = require('./storage/token');
var Utils = require('./utils/utils');
var ApiParse = require('./utils/ApiParse');
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

var Entities = require('html-entities').AllHtmlEntities;
var entities = new Entities();
/*
 * Be sure to setup your config values before running this code. You can
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and
// assets located at this address.
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

/*
 *
 * Implement server side render for onenote
 *
 */
app.get('/page', function (req, res) {
  const pageId = req.query['pageId'];
  const recipientId = req.query['recipientId'];
  if (pageId) {
    Token.GetToken(recipientId).OneNoteApi.getPageContent(pageId, true).then(function (req) {
      var content = ApiParse.ParsePageContent(req);
      res.status(200).send(renderPage(content));
    }, function (err) {
      res.sendStatus(403);
    });
    // Get page here

  } else {
    console.error("Failed get page.");
    res.sendStatus(403);
  }
});

/*
 * Use your own validation token. Check that the token used in the Webhook
 * setup is the same token used here.
 *
 */
app.get('/webhook', function (req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});


/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function (pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function (messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else if (messagingEvent.account_linking) {
          receivedAccountLink(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL.
 *
 */
app.get('/authorize', function (req, res) {
  var accountLinkingToken = req.query.account_linking_token;
  var redirectURI = req.query.redirect_uri;

  // Authorization Code should be generated per user by the developer. This will
  // be passed to the Account Linking callback.
  var authCode = "1234567890";

  var senderId = req.query.sender_id;
  var accessToken = req.query.code;

  // Redirect users to this URI on successful login
  var redirectURISuccess = redirectURI + "&authorization_code=" + authCode;
  liveConnect.requestAccessTokenByAuthCode(accessToken, senderId, function (result) {
    result["OneNoteApi"] = new onenoteapi.OneNoteApi(result.access_token, result.expires_in);
    console.log(JSON.stringify(result["OneNoteApi"]));
    console.log(result.access_token);
    Token.AddToken(senderId, result);
  });

  res.render('authorize', {
    accountLinkingToken: accountLinkingToken,
    redirectURI: redirectURI,
    redirectURISuccess: redirectURISuccess,
    senderId: senderId,
    accessToken: accessToken,
    info: JSON.stringify(Token.GetToken(senderId))
  });
  checkAndInitial(senderId);
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
      .update(buf)
      .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger'
  // plugin.
  var passThroughParam = event.optin.ref;

  console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam,
    timeOfAuth);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}

/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message'
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've
 * created. If we receive a message with an attachment (image, video, audio),
 * then we'll simply confirm that we've received the attachment.
 *
 */
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:",
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s",
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    processPostback(senderID, quickReplyPayload);
    // console.log("Quick reply for message %s with payload %s",
    //   messageId, quickReplyPayload);

    // sendTextMessage(senderID, "Quick reply tapped");
    return;
  }

  if (messageText) {
    if (Token.GetToken(senderID).ActiveEditPageId) {
      editPageAppendText(senderID, Token.GetToken(senderID).ActiveEditPageId, messageText);
      return;
    }
    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.
    switch (messageText) {
      case 'image':
        sendImageMessage(senderID);
        break;

      case 'gif':
        sendGifMessage(senderID);
        break;

      case 'audio':
        sendAudioMessage(senderID);
        break;

      case 'video':
        sendVideoMessage(senderID);
        break;

      case 'file':
        sendFileMessage(senderID);
        break;

      case 'button':
        sendButtonMessage(senderID);
        break;

      case 'list':
        sendListMessage(senderID);
        break;

      case 'generic':
        sendGenericMessage(senderID);
        break;

      case 'get started':
      case 'gs':
        sendGetStartedMessage(senderID);
        break;

      case 'receipt':
        sendReceiptMessage(senderID);
        break;

      case 'welcome':
        sendWelcome(senderID);
        break;

      case 'quick reply':
        sendQuickReply(senderID);
        break;

      case 'read receipt':
        sendReadReceipt(senderID);
        break;

      case 'typing on':
        sendTypingOn(senderID);
        break;

      case 'typing off':
        sendTypingOff(senderID);
        break;

      case 'account linking':
      case 'al':
        sendAccountLinking(senderID);
        break;

      case 'account testing':
        sendAccountTesting(senderID);
        break;
      case 'quick':
        openQuickNoteSection(senderID);
        break;
      case 'cpt':
        sendCreatePageTest(senderID);
        break;

      case 'render':
        sendRenderTest(senderID);
        break;

      default:
        addQuickNote(senderID, messageText);
    }
  } else if (messageAttachments) {
    if (Token.GetToken(senderID).ActiveEditPageId) {
      if (Array.isArray(messageAttachments)) {
        editPageAppendMultimedias(senderID, Token.GetToken(senderID).ActiveEditPageId, messageAttachments);
        // if (messageAttachments[0].type == "image") {
        //   editPageAppendImages(senderID, Token.GetToken(senderID).ActiveEditPageId, messageAttachments);
        // }
      }
      else {
        // if (messageAttachments.type == "video") {
        //   editPageAppendVideo(senderID, Token.GetToken(senderID).ActiveEditPageId, messageAttachments);
        // }
      }
      return;
    }
    quickNoteForImg(senderID, messageAttachments);

    //sendTextMessage(senderID, "Message with attachment received");
  }
}

function quickNoteForImg(recipientId, messageAttachments) {
  getTextFromImg(recipientId, messageAttachments, saveImgQuickNote);
}

function saveImgQuickNote(recipientId, text, messageAttachments) {
  const res = getIntention(text);
  const label = res.intents[0].intent;
  var pageName = label === "Travel Plan"? label : "Images";
  var pageId;
  pageId = await getQuickNotePageId(recipientId, label);
  if(!pageId){
    console.log('no page id!');
    return;
  }

  editPageAppendMultimedias(recipientId, pageId, messageAttachments);
  sendTextMessage(recipientId, 'Image saved in '+ label);

}

function addQuickNote(recipientId, text) {
  if (!Token.AlreadyLoggedIn(recipientId)) {
    sendAccountLinking(recipientId);
    return;
  }
  const res = getIntention(text);
  var intents = res.intents.slice(0, 2);
  var noOthers = true;
  for (var n in intents) {
    if (intents[n].intent == 'None') {
      intents[n].intent = 'Others';
      noOthers = false;
    }
  }
  if (noOthers) {
    intents.push({ intent: 'Others', score: 0.01 })
  }

  var quick_replies = [];
  for (var n in intents) {
    quick_replies.push({
      "content_type": "text",
      "title": intents[n].intent,
      "payload": "ADD_QUICK_NOTE " + encodeURI(intents[n].intent) + " " + encodeURI(text),
    });
  }
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "Select a recommend page to append!",
      quick_replies: quick_replies
    }
  };

  callSendAPI(messageData);
}

function parseMultiline(text, pTag) {
  var res = '';
  var lines = text.split('\n');
  lines.forEach(function (line) {
    if (line != '')
      res += pTag + line + '</p>\r\n';
  })
  return res;
}

function editPageAppendText(recipientId, pageId, text, noContinue, dataTag) {
  var pTag = '<p>';
  if (dataTag) {
    pTag = '<p data-tag="to-do">';
  }

  var content = parseMultiline(text, pTag);

  sendTextMessage(recipientId, content);
  var revisions = [{
    target: 'body',
    action: 'append',
    content: content
  }];
  var promise = Token.GetToken(recipientId).OneNoteApi.updatePage(pageId, revisions);
  promise.then(function (req) {
    if (noContinue) {
      sendTextMessage(recipientId, 'Done.')
      return;
    }
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        text: "Continue to send some message to append to the page!",
        quick_replies: [
          {
            "content_type": "text",
            "title": "End edit",
            "payload": "END_EDIT_PAGE param"
          }
        ]
      }
    };

    callSendAPI(messageData);
  });
}

function editPageAppendMultimedias(recipientId, pageId, attachments) {
  var revisions = attachments.map(function (attachment) {
    var content;
    if (attachment.type == "image") {
      content = '<img src="' + attachment.payload.url + '"/>';
    } else if (attachment.type == "video") {
      content = '<iframe data-original-src="' + attachment.payload.url + '"/>';
    } else {
      content = "<p></p>";
    }
    return {
      target: 'body',
      action: 'append',
      position: 'after',
      content: content
    }
  });
  var promise = Token.GetToken(recipientId).OneNoteApi.updatePage(pageId, revisions);
  promise.then(function (req) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        text: "Continue to send some message to append to the page!",
        quick_replies: [
          {
            "content_type": "text",
            "title": "End edit",
            "payload": "END_EDIT_PAGE param"
          }
        ]
      }
    };

    callSendAPI(messageData);
  });
}

function editPageAppendVideo(recipientId, pageId, attachment) {
  var revisions = [{
    target: 'body',
    action: 'append',
    position: 'after',
    content: '<iframe data-original-src="' + attachment.payload.url + '"/>'
  }];
  var promise = Token.GetToken(recipientId).OneNoteApi.updatePage(pageId, revisions);
  promise.then(function (req) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        text: "Continue to send some message to append to the page!",
        quick_replies: [
          {
            "content_type": "text",
            "title": "End edit",
            "payload": "END_EDIT_PAGE param"
          }
        ]
      }
    };
    callSendAPI(messageData);
  });
}

function editPageAppendImages(recipientId, pageId, attachments) {
  var revisions = attachments.map(function (attachment) {
    return {
      target: 'body',
      action: 'append',
      position: 'after',
      content: '<img src="' + attachment.payload.url + '"/>'
    }
  });
  var promise = Token.GetToken(recipientId).OneNoteApi.updatePage(pageId, revisions);
  promise.then(function (req) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        text: "Continue to send some message to append to the page!",
        quick_replies: [
          {
            "content_type": "text",
            "title": "End edit",
            "payload": "END_EDIT_PAGE param"
          }
        ]
      }
    };

    callSendAPI(messageData);
  });
}

/*
 * Delivery Confirmation Event
 * 
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function (messageID) {
      console.log("Received delivery confirmation for message ID: %s",
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);

  processPostback(senderID, payload);
}

function processPostback(recipientId, payload) {
  var list = payload.split(' ');
  if (list.length > 1) {
    var type = list[0];
    var param = list[1];
    switch (type) {
      case "LIST_NOTEBOOKS":
        sendGetStartedMessage(recipientId);
        break;
      case "LIST_SECTIONS":
        processOpenNotebookPostback(recipientId, Token.GetToken(recipientId).ActiveNotebookId);
        break;
      case "LIST_PAGES":
        processOpenSectionPostback(recipientId, Token.GetToken(recipientId).ActiveSectionId);
        break;
      case "OPEN_NOTEBOOK":
        processOpenNotebookPostback(recipientId, param);
        break;
      case "OPEN_SECTION":
        processOpenSectionPostback(recipientId, param);
        break;
      case "EDIT_PAGE":
        processEditPagePostback(recipientId, param);
        break;
      case "END_EDIT_PAGE":
        processEndEditPagePostback(recipientId);
        break;
      case "FAVOURITE_PAGE":
        processFavouritePagePostback(recipientId, param);
        break;
      case "UN_FAVOURITE_PAGE":
        processUnFavouritePagePostback(recipientId, param);
        break;
      case "LIST_FAVOURITE_PAGES":
        processListFavouritePagesPostback(recipientId, param);
        break;
      case "LIST_QUICK_NOTES":
        openQuickNoteSection(recipientId);
        break;
      case "ADD_QUICK_NOTE":
        // sendTextMessage(recipientId, list[2]);
        processQuickNotePostBack(recipientId, list[1], list[2]);
        break;
      default:
        sendTextMessage(recipientId, payload);
        break;
    }
    return;
  }
  sendTextMessage(recipientId, payload);
}

function processOpenNotebookPostback(recipientId, notebookId) {
  if (!Token.GetToken(recipientId)) {
    return;
  }
  Token.GetToken(recipientId).ActiveEditPageId = undefined;
  Token.GetToken(recipientId).ActiveSectionId = undefined;
  Token.GetToken(recipientId).ActiveNotebookId = notebookId;
  var promise = Token.GetToken(recipientId).OneNoteApi.getSections({ notebookId: notebookId });
  promise.then(function (req) {
    var sections = ApiParse.ParseSections(req);
    var elements = sections.map(function (section) {
      return {
        title: section.name,
        subtitle: "Created by: " + section.createdBy + "\nLast modified: " + section.lastModifiedTime + "\nParent notebook: " + section.parentNotebook.name,
        buttons: [{
          type: "postback",
          title: "Open Section",
          payload: "OPEN_SECTION " + section.id
        }]
      }
    });
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: elements
          }
        }
      }
    };
    callSendAPI(messageData);
  });
}

var getQuickNotePageId = async(function (recipientId, pageName) {
  var resp = await(
    Token.GetToken(recipientId).OneNoteApi.getPages({ sectionId: Token.getDefaultSectionId(recipientId) })
  );
  var pages = ApiParse.ParsePages(resp);
  var pageId = null;
  for (var n in pages) {
    if (pages[n].title === pageName) {
      pageId = pages[n].id;
    }
  }
  return pageId;
});

var processQuickNotePostBack = async(function (recipientId, pageName, text) {
  pageName = decodeURI(pageName);
  text = decodeURI(text);

  var pageId = await getQuickNotePageId(recipientId, pageName);

  if (!pageId) {
    console.log('page name ' + pageName + ' not find!');
    return;
  }
  switch (pageName) {
    case 'To-do List':
    case 'Shopping List':
      editPageAppendText(recipientId, pageId, text, true, 'to-do');
      break;
    default:
      editPageAppendText(recipientId, pageId, text, true);
  }

});

function openQuickNoteSection(recipientId) {
  var sectionId = Token.getDefaultSectionId(recipientId);
  if (!sectionId) {
    console.log('null section id!');
    return;
  }
  Token.GetToken(recipientId).ActiveEditPageId = undefined;
  Token.GetToken(recipientId).ActiveSectionId = undefined;
  Token.GetToken(recipientId).ActiveNotebookId = undefined;

  console.log('default section: ' + sectionId);
  var promise = Token.GetToken(recipientId).OneNoteApi.getPages({ sectionId: sectionId });
  promise.then(function (req) {
    var pages = ApiParse.ParsePages(req);
    var elements = pages.map(function (page) {
      return {
        title: page.title ? page.title : "UNTITLED",
        subtitle: "Created by: " + (page.createdBy ? page.createdBy : page.createdByAppId) + "\nLast modified: " + page.lastModifiedTime,
        buttons: [{
          type: "web_url",
          title: "Open Page",
          "url": SERVER_URL + "/page?pageId=" + page.id + "&recipientId=" + recipientId
        }, {
          type: "postback",
          title: "Edit Page",
          payload: "EDIT_PAGE " + page.id
        }]
      }
    });
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: elements
          }
        }
      }
    };
    callSendAPI(messageData);
  });
}

function processOpenSectionPostback(recipientId, sectionId) {
  if (!Token.GetToken(recipientId)) {
    return;
  }
  Token.GetToken(recipientId).ActiveEditPageId = undefined;
  Token.GetToken(recipientId).ActiveSectionId = sectionId;
  var promise = Token.GetToken(recipientId).OneNoteApi.getPages({ sectionId: sectionId });
  promise.then(function (req) {
    var pages = ApiParse.ParsePages(req);
    var elements = pages.map(function (page) {
      return {
        title: page.title ? page.title : "UNTITLED",
        subtitle: "Created by: " + (page.createdBy ? page.createdBy : page.createdByAppId) + "\nLast modified: " + page.lastModifiedTime,
        buttons: [{
          type: "web_url",
          title: "Open",
          "url": SERVER_URL + "/page?pageId=" + page.id + "&recipientId=" + recipientId
        }, {
          type: "postback",
          title: "Edit",
          payload: "EDIT_PAGE " + page.id
        }, {
          type: "postback",
          title: "Favourite",
          payload: "FAVOURITE_PAGE " + page.id
        }]
      }
    });
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: elements
          }
        }
      }
    };
    callSendAPI(messageData);
  });
}

function processEditPagePostback(recipientId, pageId) {
  if (!Token.GetToken(recipientId)) {
    return;
  }
  Token.GetToken(recipientId).ActiveEditPageId = pageId;
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "Send some message to append to the page!",
      quick_replies: [
        {
          "content_type": "text",
          "title": "End edit",
          "payload": "END_EDIT_PAGE param"
        }
      ]
    }
  };

  callSendAPI(messageData);
}

function processEndEditPagePostback(recipientId) {
  Token.GetToken(recipientId).ActiveEditPageId = undefined;
  sendTextMessage(recipientId, "End Edit Page");
}

function processFavouritePagePostback(recipientId, pageId) {
  Token.addFavouritePageId(recipientId, pageId);
  sendTextMessage(recipientId, "Favourite Page!");
}

function processUnFavouritePagePostback(recipientId, pageId) {
  Token.removeFavouritePageId(recipientId, pageId);
  sendTextMessage(recipientId, "Unfavourite Page!");
}

function processListFavouritePagesPostback(recipientId) {
  var favouriteIds = Token.getFavouritePageIds(recipientId);
  if (!favouriteIds || favouriteIds.length < 1) {
    sendTextMessage(recipientId, "No favourite pages!");
    return;
  }
  var batchRequest = new onenoteapi.BatchRequest();
  favouriteIds.forEach(function (pageId) {
    var operation = {};
    operation.httpMethod = "GET";
    operation.uri = "https://www.onenote.com/api/v1.0/me/notes/pages/" + pageId;
    operation.contentType = "application/json";
    batchRequest.addOperation(operation);
  });

  var promise = Token.GetToken(recipientId).OneNoteApi.sendBatchRequest(batchRequest, function (req) {
    var pages = ApiParse.ParseGetPagesBatch(req);
    Token.GetToken(recipientId).ActiveEditPageId = undefined;
    Token.GetToken(recipientId).ActiveSectionId = undefined;
    Token.GetToken(recipientId).ActiveNotebookId = undefined;

    var elements = pages.map(function (page) {
      return {
        title: page.title ? page.title : "UNTITLED",
        subtitle: "Created by: " + (page.createdBy ? page.createdBy : page.createdByAppId) + "\nLast modified: " + page.lastModifiedTime,
        buttons: [{
          type: "web_url",
          title: "Open",
          "url": SERVER_URL + "/page?pageId=" + page.id + "&recipientId=" + recipientId
        }, {
          type: "postback",
          title: "Edit",
          payload: "EDIT_PAGE " + page.id
        }, {
          type: "postback",
          title: "Unfavourite",
          payload: "UN_FAVOURITE_PAGE " + page.id
        }]
      }
    });
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: elements
          }
        }
      }
    };
    callSendAPI(messageData);
  });
}

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  // All messages before watermark (a timestamp) or sequence have been seen.
  var watermark = event.read.watermark;
  var sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
    "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  var status = event.account_linking.status;
  var authCode = event.account_linking.authorization_code;

  console.log("Received account link event with for user %d with status %s " +
    "and auth code %s ", senderID, status, authCode);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: SERVER_URL + "/assets/rift.png"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: SERVER_URL + "/assets/instagram_logo.gif"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "audio",
        payload: {
          url: SERVER_URL + "/assets/sample.mp3"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 *
 */
function sendVideoMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "video",
        payload: {
          url: SERVER_URL + "/assets/allofus480.mov"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a file using the Send API.
 *
 */
function sendFileMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "file",
        payload: {
          url: SERVER_URL + "/assets/test.txt"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

function sendTextToClassify(recipientId, messageText) {
  const res = getIntention(messageText);
  sendTextMessage(recipientId, res.topScoringIntent.intent);

}
/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "This is test text",
          buttons: [{
            type: "web_url",
            url: "https://www.oculus.com/en-us/rift/",
            title: "Open Web URL"
          }, {
            type: "postback",
            title: "Trigger Postback",
            payload: "DEVELOPER_DEFINED_PAYLOAD"
          }, {
            type: "phone_number",
            title: "Call Phone Number",
            payload: "+16505551234"
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

function sendListMessage(recipientId) {
  var messageData = {
    "recipient": {
      "id": recipientId
    },
    "message": {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "list",
          "elements": [
            {
              "title": "Classic T-Shirt Collection",
              "image_url": "https://peterssendreceiveapp.ngrok.io/img/collection.png",
              "subtitle": "See all our colors",
              "default_action": {
                "type": "web_url",
                "url": "https://peterssendreceiveapp.ngrok.io/shop_collection",
                "messenger_extensions": true,
                "webview_height_ratio": "tall",
                "fallback_url": "https://peterssendreceiveapp.ngrok.io/"
              },
              "buttons": [
                {
                  "title": "View",
                  "type": "web_url",
                  "url": "https://peterssendreceiveapp.ngrok.io/collection",
                  "messenger_extensions": true,
                  "webview_height_ratio": "tall",
                  "fallback_url": "https://peterssendreceiveapp.ngrok.io/"
                }
              ]
            },
            {
              "title": "Classic White T-Shirt",
              "image_url": "https://peterssendreceiveapp.ngrok.io/img/white-t-shirt.png",
              "subtitle": "100% Cotton, 200% Comfortable",
              "default_action": {
                "type": "web_url",
                "url": "https://peterssendreceiveapp.ngrok.io/view?item=100",
                "messenger_extensions": true,
                "webview_height_ratio": "tall",
                "fallback_url": "https://peterssendreceiveapp.ngrok.io/"
              },
              "buttons": [
                {
                  "title": "Shop Now",
                  "type": "web_url",
                  "url": "https://peterssendreceiveapp.ngrok.io/shop?item=100",
                  "messenger_extensions": true,
                  "webview_height_ratio": "tall",
                  "fallback_url": "https://peterssendreceiveapp.ngrok.io/"
                }
              ]
            },
            {
              "title": "Classic Blue T-Shirt",
              "image_url": "https://peterssendreceiveapp.ngrok.io/img/blue-t-shirt.png",
              "subtitle": "100% Cotton, 200% Comfortable",
              "default_action": {
                "type": "web_url",
                "url": "https://peterssendreceiveapp.ngrok.io/view?item=101",
                "messenger_extensions": true,
                "webview_height_ratio": "tall",
                "fallback_url": "https://peterssendreceiveapp.ngrok.io/"
              },
              "buttons": [
                {
                  "title": "Shop Now",
                  "type": "web_url",
                  "url": "https://peterssendreceiveapp.ngrok.io/shop?item=101",
                  "messenger_extensions": true,
                  "webview_height_ratio": "tall",
                  "fallback_url": "https://peterssendreceiveapp.ngrok.io/"
                }
              ]
            },
            {
              "title": "Classic Black T-Shirt",
              "image_url": "https://peterssendreceiveapp.ngrok.io/img/black-t-shirt.png",
              "subtitle": "100% Cotton, 200% Comfortable",
              "default_action": {
                "type": "web_url",
                "url": "https://peterssendreceiveapp.ngrok.io/view?item=102",
                "messenger_extensions": true,
                "webview_height_ratio": "tall",
                "fallback_url": "https://peterssendreceiveapp.ngrok.io/"
              },
              "buttons": [
                {
                  "title": "Shop Now",
                  "type": "web_url",
                  "url": "https://peterssendreceiveapp.ngrok.io/shop?item=102",
                  "messenger_extensions": true,
                  "webview_height_ratio": "tall",
                  "fallback_url": "https://peterssendreceiveapp.ngrok.io/"
                }
              ]
            }
          ],
          "buttons": [
            {
              "title": "View More",
              "type": "postback",
              "payload": "payload"
            }
          ]
        }
      }
    }
  };
  callSendAPI(messageData);
}

function sendGetStartedMessage(recipientId) {
  if (!Token.AlreadyLoggedIn(recipientId)) {
    sendAccountLinking(recipientId);
  }
  else {
    Token.GetToken(recipientId).ActiveEditPageId = undefined;
    Token.GetToken(recipientId).ActiveSectionId = undefined;
    Token.GetToken(recipientId).ActiveNotebookId = undefined;
    var promise = Token.GetToken(recipientId).OneNoteApi.getNotebooks({});
    promise.then(function (req) {
      var notebooks = ApiParse.ParseNotebooks(req);
      var elements = notebooks.map(function (notebook) {
        return {
          title: notebook.name,
          subtitle: "Created by: " + notebook.createdBy + "\nLast modified: " + notebook.lastModifiedTime,
          buttons: [{
            type: "postback",
            title: "Open Notebook",
            payload: "OPEN_NOTEBOOK " + notebook.id
          }]
        }
      });
      var messageData = {
        recipient: {
          id: recipientId
        },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "generic",
              elements: elements
            }
          }
        }
      };
      callSendAPI(messageData);
    })
  }
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",
            image_url: SERVER_URL + "/assets/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble",
            }],
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",
            image_url: SERVER_URL + "/assets/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble",
            }]
          }]
        }
      },
      quick_replies: [
        {
          "content_type": "text",
          "title": "Action",
          "payload": "DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_ACTION"
        },
        {
          "content_type": "text",
          "title": "Comedy",
          "payload": "DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_COMEDY"
        },
        {
          "content_type": "text",
          "title": "Drama",
          "payload": "DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_DRAMA"
        }
      ]
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a receipt message using the Send API.
 *
 */
function sendReceiptMessage(recipientId) {
  // Generate a random receipt ID as the API requires a unique ID
  var receiptId = "order" + Math.floor(Math.random() * 1000);

  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "receipt",
          recipient_name: "Peter Chang",
          order_number: receiptId,
          currency: "USD",
          payment_method: "Visa 1234",
          timestamp: "1428444852",
          elements: [{
            title: "Oculus Rift",
            subtitle: "Includes: headset, sensor, remote",
            quantity: 1,
            price: 599.00,
            currency: "USD",
            image_url: SERVER_URL + "/assets/riftsq.png"
          }, {
            title: "Samsung Gear VR",
            subtitle: "Frost White",
            quantity: 1,
            price: 99.99,
            currency: "USD",
            image_url: SERVER_URL + "/assets/gearvrsq.png"
          }],
          address: {
            street_1: "1 Hacker Way",
            street_2: "",
            city: "Menlo Park",
            postal_code: "94025",
            state: "CA",
            country: "US"
          },
          summary: {
            subtotal: 698.99,
            shipping_cost: 20.00,
            total_tax: 57.67,
            total_cost: 626.66
          },
          adjustments: [{
            name: "New Customer Discount",
            amount: -50
          }, {
            name: "$100 Off Coupon",
            amount: -100
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "What's your favorite movie genre?",
      quick_replies: [
        {
          "content_type": "text",
          "title": "Action",
          "payload": "DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_ACTION"
        },
        {
          "content_type": "text",
          "title": "Comedy",
          "payload": "DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_COMEDY"
        },
        {
          "content_type": "text",
          "title": "Drama",
          "payload": "DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_DRAMA"
        }
      ]
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
  console.log("Sending a read receipt to mark message as seen");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "mark_seen"
  };

  callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {
  console.log("Turning typing indicator on");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_on"
  };

  callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {
  console.log("Turning typing indicator off");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_off"
  };

  callSendAPI(messageData);
}


/*
 * Send a message with the welcome call-to-action
 *
 */
function sendWelcome(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "Link to your onenote",
            subtitle: "Log in once, take notes everywhere",
            image_url: SERVER_URL + "/assets/welcomeIcon.png",
            item_url: liveConnect.getAuthUrl(recipientId),
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "account_link",
              url: SERVER_URL + "/authorize"
            }, {
              "type": "web_url",
              "url": "http://www.baidu.com",
              "title": "Select Criteria",
              "webview_height_ratio": "full"
            }
            ]
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}
/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
  if (Token.AlreadyLoggedIn(recipientId)) {
    sendTextMessage(recipientId, Token.GetToken(recipientId).access_token.substring(0, 50));
  }
  else {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "Welcome. Link your account.",
            buttons: [{
              type: "web_url",
              url: liveConnect.getAuthUrl(recipientId),
              title: "Login"
            }]
          }
        }
      }
    }
    callSendAPI(messageData);
  };

}

function sendAccountTesting(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: liveConnect.getAuthUrl(recipientId),
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a button message using the Send API.
 *
 */
function sendPageMessage(recipientId, page) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: page.title,
          buttons: [{
            type: "web_url",
            url: SERVER_URL + "/page?pageId=" + page.id + "&recipientId=" + recipientId,
            title: "Open Page"
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

function checkAndInitial(recipientId) {
  var promise = Token.GetToken(recipientId).OneNoteApi.getNotebooks({ isDefault: true });
  promise.then(function (req) {
    var res = ApiParse.ParseNotebooks(req);
    if (res.length == 0) {
      console.log("No default notebook");
      sendTextMessage(recipientId, 'No default notebook');
    } else {
      var quickNotebookId = res[0].id;
      var secPromise = Token.GetToken(recipientId).OneNoteApi.getSections({ quickNote: true });

      secPromise.then(function (resp) {
        console.log("get section result");
        console.log(JSON.stringify(resp));
        var sections = ApiParse.ParseSections(resp);
        if (sections.length == 0) {
          sendTextMessage(recipientId, 'Initialing...That may take a few seconds');
          Token.GetToken(recipientId).OneNoteApi.createSection(quickNotebookId, "OneNote Messenger").then(
            function (resp) {
              sendTypingOn(recipientId);
              console.log('start create page');
              var section = ApiParse.ParseResponseText(resp);
              Token.setDefaultSectionId(recipientId, section.id);
              createInitialPages(recipientId, section.id, [
                'To-do List', 'Travel Plan', 'Knowledge', 'Shopping List', 'Tech', 'Images', 'Others'
              ]);
            },
            function (error) {
              console.log("fail on createSection");
              console.log(JSON.stringify(error));
              reject(error);
            });
        } else {
          console.log("already initialed..");
          Token.setDefaultSectionId(recipientId, sections[0].id);

        }
      });
    }
  });
}

function sendCreatePageTest(recipientId) {
  if (!Token.AlreadyLoggedIn(recipientId)) {
    sendAccountLinking(recipientId);
  }
  else {
    var promise = Token.GetToken(recipientId).OneNoteApi.getNotebooks({ isDefault: true });
    promise.then(function (req) {
      var res = ApiParse.ParseNotebooks(req);
      if (res.length == 0) {

      } else {
        var quickNotebookId = res[0].id;
        var secPromise = Token.GetToken(recipientId).OneNoteApi.getSections({ quickNote: true });

        secPromise.then(function (resp) {
          console.log("get section result");
          console.log(JSON.stringify(resp))
          var sections = ApiParse.ParseSections(resp);
          if (sections.length == 0) {
            Token.GetToken(recipientId).OneNoteApi.createSection(quickNotebookId, "OneNote Messenger").then(
              function (resp) {
                var section = ApiParse.ParseResponseText(resp);

                console.log('start create page');
                createInitialPages(recipientId, section.id, [
                  'To-do List', 'Travel Plan', 'Knowledge', 'Shooping List', 'Tech', 'Others'
                ]);
              },
              function (error) {
                console.log("fail on createSection");
                console.log(JSON.stringify(error));
                reject(error);
              }
            );
          }
        })
        var prom = Token.GetToken(recipientId).OneNoteApi.createSection();
      }
      console.log(JSON.stringify(res));
      var list = res.map(function (notebook) {
        return notebook.name;
      });
      sendTextMessage(recipientId, JSON.stringify(list));
    })
  }
}

var createInitialPages = async(function (recipientId, sectionId, pageNames) {
  var n = 0;
  pageNames.forEach(function (pagename) {
    var page = new onenoteapi.OneNotePage(pagename);
    try {
      var res = await(Token.GetToken(recipientId).OneNoteApi.createPage(page, sectionId));
      console.log("createpage on " + pagename);
      n++;
    } catch (error) {
      console.log(JSON.stringify(error));
      sendTypingOff(recipientId);
      sendTextMessage(recipientId, 'Initial failed, please try again.');
      console.log("fail on createpage");
      return;
    }
    if (n == pageNames.length) {
      sendTypingOff(recipientId);
      sendTextMessage(recipientId, 'Initial finished.');
    }
  });
});
function createPage(recipientId, sectionId, pageName) {
  console.log('start create page')
  createExamples.createInitialPage(Token.GetAcessToken(recipientId), pageName, function () {
    sendTextMessage(recipientId, "Create Page Test Finished!");
  });
}

function sendRenderTest(recipientId) {
  if (!Token.AlreadyLoggedIn(recipientId)) {
    sendAccountLinking(recipientId);
  }
  else {
    Token.GetToken(recipientId).OneNoteApi.getPages({ top: 1 }).then(function (req) {
      var pageList = ApiParse.ParsePages(req);
      console.log(JSON.stringify(pageList[0]));
      sendPageMessage(recipientId, pageList[0]);
    });
  }
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
  setQuickReplyMessageData(messageData);
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s",
          messageId, recipientId);
      } else {
        console.log("Successfully called Send API for recipient %s",
          recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });
}

function setQuickReplyMessageData(messageData) {
  if (!messageData.message) {
    return;
  }
  var recipientId = messageData.recipient.id;
  if (!messageData.message.quick_replies && Token.GetToken(recipientId)) {
    if (Token.GetToken(recipientId).ActiveSectionId) {
      messageData.message.quick_replies = [
        {
          content_type: "text",
          title: "List Sections",
          payload: "LIST_SECTIONS secondparam"
        },
        {
          content_type: "text",
          title: "List Pages",
          payload: "LIST_PAGES secondparam"
        }
      ];
    }
    else if (Token.GetToken(recipientId).ActiveNotebookId) {
      messageData.message.quick_replies = [
        {
          content_type: "text",
          title: "List Notebooks",
          payload: "LIST_NOTEBOOKS secondparam"
        },
        {
          content_type: "text",
          title: "List Sections",
          payload: "LIST_SECTIONS secondparam"
        }
      ];
    }
  }
}

function callSettingsAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/thread_settings',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      if (body.result) {
        console.log(body.result);
      }
      else {
        console.log("Successfully added new_thread's CTAs 2");
      }
    } else {
      console.error("Failed calling Setting API", response.statusCode, response.statusMessage, body.error);
    }
  });
}

function setPersistentMenu() {
  var messageData = {
    setting_type: "call_to_actions",
    thread_state: "existing_thread",
    call_to_actions: [
      {
        type: "postback",
        title: "Quick notes",
        payload: "LIST_QUICK_NOTES secondparam"
      },
      {
        type: "postback",
        title: "Favourite Pages",
        payload: "LIST_FAVOURITE_PAGES secondparam"
      },
      {
        type: "postback",
        title: "List Notebooks",
        payload: "LIST_NOTEBOOKS secondparam"
      },
    ]
  };
  callSettingsAPI(messageData);
}

//const res = getTextFromImg(111, {payload:{'url':'https://scontent.xx.fbcdn.net/v/t34.0-12/16684453_1267359186690196_2139830557_n.jpg?_nc_ad=z-m&oh=8bf55d868c88892362f4d41758b6d8c6&oe=58A039F3'}}, sendTextMessage);
// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.

// var page = new onenoteapi.OneNotePage('To-do List');
// var form = page.getTypedFormData();
// var blob = form.asBlob();
// var content = form.getContentType();
// console.log('start create page');
// onenoteapi.createPage(page, 123).then(function (resp) {
//   console.log(JSON.stringify(resp));
// });
// createInitialPages(111, 111, [
//   'To-do List', 'Travel Plan', 'Knowledge', 'Shooping List', 'Tech', 'Others'
// ]);
// createInitialPages(111, 111, '123');
//const res = getIntention('message');
//var res = encodeURI('abc <>');
app.listen(app.get('port'), function () {
  console.log(liveConnect.getAuthUrl());
  console.log('Node app is running on port', app.get('port'));
  setPersistentMenu();
});

module.exports = app;
