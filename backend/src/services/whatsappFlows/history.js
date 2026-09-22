const supabase = require('../../config/supabase');
const { sendList, sendText, sendButtons, uploadMedia, sendDocument } = require('../../config/whatsapp');
const { formatCurrency } = require('../../utils/formatCurrency');
const { fetchQuoteWithItems } = require('./orderConversion');
const { generateQuotePdfBuffer } = require('../quotePdfService');

// Same practical cap used by orderConversion.js's review screen -- long
// item lists get truncated with a pointer at the PDF (quotes only; orders
// have no PDF export today) rather than blowing past WhatsApp's body length.
const MAX_PREVIEW_LINES = 10;

const QUOTE_DETAIL_BUTTONS = [
  { id: 'history_quote_download', title: 'Download PDF' },
  { id: 'history_quote_back', title: 'Back to list' },
  { id: 'history_menu', title: 'Main menu' },
];

const ORDER_DETAIL_BUTTONS = [
  { id: 'history_order_back', title: 'Back to list' },
  { id: 'history_menu', title: 'Main menu' },
];

function formatStatus(status) {
  return status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

async function startQuotes(conversation) {
  const { phone, user_id } = conversation;

  const { data: quotes, error } = await supabase
    .from('quotes')
    .select('id, quote_number, status, total_amount, created_at')
    .eq('customer_id', user_id)
    .order('created_at', { ascending: false })
    .limit(10); // same list cap/simplification used everywhere else -- most recent 10, no pagination

  if (error) {
    await sendText(phone, 'Sorry, something went wrong loading your quotes. Try again shortly.');
    return { newState: 'main_menu', newContext: {} };
  }
  if (!quotes.length) {
    await sendText(phone, "You don't have any quotes yet. Pick \"Create a quotation\" from the menu first.");
    const { sendMenu } = require('./mainMenu');
    await sendMenu(phone);
    return { newState: 'main_menu', newContext: {} };
  }

  await sendList(phone, {
    header: 'Your quotes',
    body: 'Pick a quote to view:',
    buttonText: 'Quotes',
    sections: [
      {
        title: 'All quotes',
        rows: quotes.map((q) => ({
          id: `hist_quote_${q.id}`,
          // WhatsApp caps interactive list row titles at 24 characters --
          // status goes in the description (72-char cap) instead, since
          // "Quote #14 · Submitted" style titles can run over that.
          title: `Quote #${q.quote_number}`,
          description: `${formatStatus(q.status)} · ${formatCurrency(q.total_amount)} · ${new Date(q.created_at).toLocaleDateString()}`,
        })),
      },
    ],
  });

  return { newState: 'history_selecting_quote', newContext: {} };
}

async function sendQuoteDetail(phone, quote) {
  const items = quote.quote_items;
  const lines = items
    .slice(0, MAX_PREVIEW_LINES)
    .map((i) => `${i.quantity}x ${i.products?.name} · ${formatCurrency(i.unit_price * i.quantity)}`);
  const extra =
    items.length > MAX_PREVIEW_LINES
      ? `\n+${items.length - MAX_PREVIEW_LINES} more. Download the PDF for the full list.`
      : '';

  await sendButtons(phone, {
    body: `Quote #${quote.quote_number} · ${formatStatus(quote.status)}\n${lines.join('\n')}${extra}\n\nTotal: ${formatCurrency(quote.total_amount)}`,
    buttons: QUOTE_DETAIL_BUTTONS,
  });

  return { newState: 'history_selecting_quote', newContext: { quoteId: quote.id } };
}

async function handleQuoteDownload(phone, quote) {
  const buffer = generateQuotePdfBuffer({ quote, items: quote.quote_items, customer: quote.users });
  const filename = `Quote-${quote.quote_number}.pdf`;
  const mediaId = await uploadMedia(buffer, filename, 'application/pdf');

  if (mediaId) {
    await sendDocument(phone, mediaId, filename, `Quote #${quote.quote_number}`);
  } else {
    await sendText(phone, "Sorry, couldn't generate that PDF right now. Try again shortly.");
  }

  return sendQuoteDetail(phone, quote);
}

async function startOrders(conversation) {
  const { phone, user_id } = conversation;

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_number, status, total_amount, created_at')
    .eq('customer_id', user_id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    await sendText(phone, 'Sorry, something went wrong loading your orders. Try again shortly.');
    return { newState: 'main_menu', newContext: {} };
  }
  if (!orders.length) {
    await sendText(phone, "You don't have any orders yet. Convert a quote into one from the menu first.");
    const { sendMenu } = require('./mainMenu');
    await sendMenu(phone);
    return { newState: 'main_menu', newContext: {} };
  }

  await sendList(phone, {
    header: 'Your orders',
    body: 'Pick an order to view:',
    buttonText: 'Orders',
    sections: [
      {
        title: 'All orders',
        rows: orders.map((o) => ({
          id: `hist_order_${o.id}`,
          // Same 24-char row-title cap as the quotes list above.
          title: `Order #${o.order_number}`,
          description: `${formatStatus(o.status)} · ${formatCurrency(o.total_amount)} · ${new Date(o.created_at).toLocaleDateString()}`,
        })),
      },
    ],
  });

  return { newState: 'history_selecting_order', newContext: {} };
}

// Scoped to this customer, same as fetchQuoteWithItems -- someone can never
// fetch another customer's order by guessing/tampering with an order id.
async function fetchOrderWithItems(orderId, customerId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*, products(name, sku)), payments(status)')
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .single();

  if (error || !data) return null;
  return data;
}

async function sendOrderDetail(phone, order) {
  const items = order.order_items;
  const lines = items
    .slice(0, MAX_PREVIEW_LINES)
    .map((i) => `${i.quantity}x ${i.products?.name} · ${formatCurrency(i.unit_price * i.quantity)}`);
  const extra = items.length > MAX_PREVIEW_LINES ? `\n+${items.length - MAX_PREVIEW_LINES} more` : '';

  const hasActivePayment = order.payments?.some((p) => p.status === 'submitted' || p.status === 'approved');
  // The same two payable statuses paymentService.js works from: 'approved'
  // (manual-approval flow) and 'stock_reserved' (fast-checkout flow).
  // WhatsApp can't take a payment -- customers pay through PayFast in the
  // portal, or arrange an EFT with the team -- so this points at the portal
  // rather than into a flow.
  const isPayable = ['approved', 'stock_reserved'].includes(order.status);
  const paymentNudge =
    isPayable && !hasActivePayment
      ? '\n\nThis order is awaiting payment. Open it in the Tyrotec portal to pay, or contact us to arrange an EFT.'
      : '';

  await sendButtons(phone, {
    body: `Order #${order.order_number} · ${formatStatus(order.status)}\n${lines.join('\n')}${extra}\n\nTotal: ${formatCurrency(order.total_amount)}${paymentNudge}`,
    buttons: ORDER_DETAIL_BUTTONS,
  });

  return { newState: 'history_selecting_order', newContext: { orderId: order.id } };
}

async function handle(conversation, message) {
  const { phone, state, context } = conversation;
  const choice = message.interactiveId;

  if (state === 'history_selecting_quote') {
    if (choice === 'history_menu') {
      const { sendMenu } = require('./mainMenu');
      await sendMenu(phone);
      return { newState: 'main_menu', newContext: {} };
    }

    if (choice === 'history_quote_back') {
      return startQuotes(conversation);
    }

    if (choice && choice.startsWith('hist_quote_')) {
      const quoteId = choice.slice('hist_quote_'.length);
      const quote = await fetchQuoteWithItems(quoteId, conversation.user_id);
      if (!quote) {
        await sendText(phone, "Sorry, that quote isn't available anymore.");
        return { newState: 'main_menu', newContext: {} };
      }
      return sendQuoteDetail(phone, quote);
    }

    if (choice === 'history_quote_download' && context.quoteId) {
      const quote = await fetchQuoteWithItems(context.quoteId, conversation.user_id);
      if (!quote) {
        await sendText(phone, "Sorry, that quote isn't available anymore.");
        return { newState: 'main_menu', newContext: {} };
      }
      return handleQuoteDownload(phone, quote);
    }

    await sendText(phone, 'Please pick a quote from the list, or reply "menu" to go back.');
    return { newState: 'history_selecting_quote', newContext: context };
  }

  if (state === 'history_selecting_order') {
    if (choice === 'history_menu') {
      const { sendMenu } = require('./mainMenu');
      await sendMenu(phone);
      return { newState: 'main_menu', newContext: {} };
    }

    if (choice === 'history_order_back') {
      return startOrders(conversation);
    }

    if (choice && choice.startsWith('hist_order_')) {
      const orderId = choice.slice('hist_order_'.length);
      const order = await fetchOrderWithItems(orderId, conversation.user_id);
      if (!order) {
        await sendText(phone, "Sorry, that order isn't available anymore.");
        return { newState: 'main_menu', newContext: {} };
      }
      return sendOrderDetail(phone, order);
    }

    await sendText(phone, 'Please pick an order from the list, or reply "menu" to go back.');
    return { newState: 'history_selecting_order', newContext: context };
  }

  const { sendMenu } = require('./mainMenu');
  await sendMenu(phone);
  return { newState: 'main_menu', newContext: {} };
}

module.exports = { startQuotes, startOrders, handle };
