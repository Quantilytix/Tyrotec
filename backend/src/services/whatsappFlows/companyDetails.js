const { sendText } = require('../../config/whatsapp');

// Static reply, no backend logic -- edit this text to change what shows up.
const DETAILS_TEXT =
  'Tyrotec\n\nYour B2B supplier for industrial parts and supplies.\n\n' +
  'Reply "menu" any time to come back to the main menu.';

async function send(phone) {
  await sendText(phone, DETAILS_TEXT);
  const { sendMenu } = require('./mainMenu');
  await sendMenu(phone);
  return { newState: 'main_menu', newContext: {} };
}

module.exports = { send };
