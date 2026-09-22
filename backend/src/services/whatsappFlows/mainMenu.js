const { sendList } = require('../../config/whatsapp');

const MENU_SECTIONS = [
  {
    title: 'Main menu',
    rows: [
      { id: 'menu_view_products', title: '📦 View all products', description: 'Browse the full catalog' },
      { id: 'menu_build_quote', title: '📝 Create a quotation', description: 'Build a quote to submit' },
      { id: 'menu_convert_quote', title: '🛒 Convert quote to order', description: 'Turn a saved quote into an order' },
      { id: 'menu_view_quotes', title: '📄 My quotes', description: 'View your past and current quotes' },
      { id: 'menu_view_orders', title: '📦 My orders', description: 'View your past and current orders' },
      { id: 'menu_company_details', title: 'ℹ️ Tyrotec details', description: 'Contact info & more' },
    ],
  },
];

async function sendMenu(phone, greeting) {
  await sendList(phone, {
    header: 'Tyrotec',
    body: greeting || 'Choose an option to get started:',
    buttonText: 'Menu',
    sections: MENU_SECTIONS,
  });
}

// Dispatches a menu selection into the *entry* step of the right flow. Each
// flow module's own handle() takes over from there once the conversation's
// state has moved into that flow. Required lazily (not at top-level) to
// avoid a circular require -- those flows come back to sendMenu() when done.
async function handle(conversation, message) {
  const { phone } = conversation;
  const choice = message.interactiveId;

  if (choice === 'menu_view_products') {
    return require('./productBrowsing').startCategoryList(phone, 'view');
  }
  if (choice === 'menu_build_quote') {
    return require('./productBrowsing').startCategoryList(phone, 'quote');
  }
  if (choice === 'menu_convert_quote') {
    return require('./orderConversion').start(conversation);
  }
  if (choice === 'menu_view_quotes') {
    return require('./history').startQuotes(conversation);
  }
  if (choice === 'menu_view_orders') {
    return require('./history').startOrders(conversation);
  }
  if (choice === 'menu_company_details') {
    return require('./companyDetails').send(phone);
  }

  await sendMenu(phone, "Sorry, I didn't catch that.");
  return { newState: 'main_menu', newContext: {} };
}

module.exports = { sendMenu, handle };
