const crypto = require('crypto');
const supabase = require('../config/supabase');
const { getOrCreateConversation, updateConversation } = require('../services/whatsappConversationService');
const accountResolution = require('../services/whatsappFlows/accountResolution');
const mainMenu = require('../services/whatsappFlows/mainMenu');
const productBrowsing = require('../services/whatsappFlows/productBrowsing');
const quoteBuilding = require('../services/whatsappFlows/quoteBuilding');
const orderConversion = require('../services/whatsappFlows/orderConversion');
const history = require('../services/whatsappFlows/history');

// Meta's one-time handshake when the webhook URL is registered in the Meta
// dashboard: echo hub.challenge back as plain text if the verify token
// matches what we configured there, otherwise refuse.
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

// HMAC-SHA256 over the *raw* request body (app.js captures req.rawBody for
// this route specifically -- the parsed/re-serialized JSON object would not
// reproduce the exact bytes Meta signed). Without this check, anyone who
// finds the webhook URL could POST fake incoming messages.
function isValidSignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !req.rawBody || !process.env.WHATSAPP_APP_SECRET) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(req.rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false; // e.g. length mismatch -- definitely not a match
  }
}

// Returns { id, from, text, interactiveId } for an actual incoming message,
// or null for anything else (delivery/read status updates, malformed
// payloads) which the webhook should just acknowledge and ignore.
function extractIncomingMessage(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message) return null;

  const id = message.id;
  const from = message.from;
  if (message.type === 'text') {
    return { id, from, text: message.text?.body || '', interactiveId: null };
  }
  if (message.type === 'interactive') {
    const reply = message.interactive?.list_reply || message.interactive?.button_reply;
    return { id, from, text: reply?.title || '', interactiveId: reply?.id || null };
  }
  return { id, from, text: '', interactiveId: null };
}

// Meta retries a webhook delivery if it doesn't get a fast enough response
// (e.g. a cold-starting free-tier host) -- retries resend the exact same
// message id (wamid), not a new one. Without this, a slow response to a
// single "confirm this quote" tap could create several quotes: each retry
// looks like a brand new message with nothing to say otherwise. The unique
// constraint on wamid makes this atomic -- if a concurrent/retried request
// loses the race, its insert fails and it's treated as already-processed.
async function isDuplicateMessage(wamid) {
  if (!wamid) return false;
  const { error } = await supabase.from('whatsapp_processed_messages').insert([{ wamid }]);
  if (!error) return false;
  if (error.code === '23505') return true; // unique_violation -- already seen
  throw error;
}

// Dispatches to the flow module matching the conversation's current state.
// accountResolution takes over unconditionally for anyone not yet linked to
// a user, regardless of `state` -- it manages its own sub-states.
async function routeMessage(conversation, message) {
  if (!conversation.user_id) {
    return accountResolution.handle(conversation, message);
  }

  const said = (message.text || '').trim().toLowerCase();
  if (message.interactiveId === null && (said === 'menu' || said === 'cancel')) {
    await mainMenu.sendMenu(conversation.phone);
    return { newState: 'main_menu', newContext: {} };
  }

  switch (conversation.state) {
    case 'browsing_category':
    case 'browsing_product':
      return productBrowsing.handle(conversation, message);
    case 'quote_awaiting_quantity':
    case 'quote_reviewing':
      return quoteBuilding.handle(conversation, message);
    case 'order_selecting_quote':
    case 'order_reviewing_quote':
      return orderConversion.handle(conversation, message);
    case 'history_selecting_quote':
    case 'history_selecting_order':
      return history.handle(conversation, message);
    case 'main_menu':
    default:
      return mainMenu.handle(conversation, message);
  }
}

async function receiveMessage(req, res) {
  if (!isValidSignature(req)) {
    return res.sendStatus(403);
  }

  // Ack Meta immediately-ish; message content is processed inline since
  // every step here is a handful of fast DB calls, well within Meta's
  // webhook timeout.
  const incoming = extractIncomingMessage(req.body);
  if (!incoming || !incoming.from) {
    return res.sendStatus(200);
  }

  try {
    if (await isDuplicateMessage(incoming.id)) {
      return res.sendStatus(200);
    }
    const conversation = await getOrCreateConversation(incoming.from);
    const result = await routeMessage(conversation, incoming);
    await updateConversation(conversation.id, {
      state: result.newState,
      context: result.newContext,
      userId: result.newUserId,
    });
  } catch (err) {
    console.error('WhatsApp webhook processing error:', err);
  }

  return res.sendStatus(200);
}

module.exports = { verifyWebhook, receiveMessage, extractIncomingMessage, isValidSignature };
