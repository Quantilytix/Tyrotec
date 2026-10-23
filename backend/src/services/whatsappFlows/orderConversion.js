const supabase = require('../../config/supabase');
const { sendList, sendText, sendButtons, uploadMedia, sendDocument } = require('../../config/whatsapp');
const { formatCurrency } = require('../../utils/formatCurrency');
const { convertQuoteForCustomer } = require('../quoteService');
const { flagStockShort } = require('../adminReviewService');
const { generateQuotePdfBuffer } = require('../quotePdfService');

// Interactive button body text has a practical length limit -- for a quote
// with a lot of items, cap the preview and point at the PDF for the rest
// (which conveniently makes the download button double as the overflow
// case, not just a nice-to-have).
const MAX_PREVIEW_LINES = 10;

const REVIEW_BUTTONS = [
  { id: 'order_confirm_convert', title: 'Confirm & convert' },
  { id: 'order_download_pdf', title: 'Download PDF' },
  { id: 'order_cancel', title: 'Cancel' },
];

async function start(conversation) {
  const { phone, user_id } = conversation;

  const { data: quotes, error } = await supabase
    .from('quotes')
    .select('id, quote_number, total_amount, created_at')
    .eq('customer_id', user_id)
    .eq('status', 'submitted')
    .order('created_at', { ascending: false })
    .limit(10); // list cap -- most recent 10, same simplification as category browsing

  if (error) {
    await sendText(phone, 'Sorry, something went wrong loading your quotes. Try again shortly.');
    return { newState: 'main_menu', newContext: {} };
  }
  if (!quotes.length) {
    await sendText(phone, "You don't have any saved quotes yet. Pick \"Create a quotation\" from the menu first.");
    const { sendMenu } = require('./mainMenu');
    await sendMenu(phone);
    return { newState: 'main_menu', newContext: {} };
  }

  await sendList(phone, {
    header: 'Your quotes',
    body: 'Pick a quote to view and convert into an order:',
    buttonText: 'Quotes',
    sections: [
      {
        title: 'Submitted quotes',
        rows: quotes.map((q) => ({
          id: `quote_${q.id}`,
          title: `Quote #${q.quote_number}`,
          description: `${formatCurrency(q.total_amount)} · ${new Date(q.created_at).toLocaleDateString()}`,
        })),
      },
    ],
  });

  return { newState: 'order_selecting_quote', newContext: {} };
}

// Scoped to this customer -- eq('customer_id', ...) means someone can never
// fetch another customer's quote by guessing/tampering with a quote id.
async function fetchQuoteWithItems(quoteId, customerId) {
  const { data, error } = await supabase
    .from('quotes')
    .select('*, quote_items(*, products(name, sku)), users(company_name, full_name, email, phone, vat_number, address)')
    .eq('id', quoteId)
    .eq('customer_id', customerId)
    .single();

  if (error || !data) return null;
  return data;
}

async function sendReview(phone, quote) {
  const items = quote.quote_items;
  const lines = items
    .slice(0, MAX_PREVIEW_LINES)
    .map((i) => `${i.quantity}x ${i.products?.name} · ${formatCurrency(i.unit_price * i.quantity)}`);
  const extra =
    items.length > MAX_PREVIEW_LINES
      ? `\n+${items.length - MAX_PREVIEW_LINES} more. Download the PDF for the full list.`
      : '';

  await sendButtons(phone, {
    body: `Quote #${quote.quote_number}\n${lines.join('\n')}${extra}\n\nTotal: ${formatCurrency(quote.total_amount)}\n\nWhat next?`,
    buttons: REVIEW_BUTTONS,
  });

  return { newState: 'order_reviewing_quote', newContext: { quoteId: quote.id } };
}

async function handleDownload(phone, conversation, quote) {
  const buffer = generateQuotePdfBuffer({ quote, items: quote.quote_items, customer: quote.users });
  const filename = `Quote-${quote.quote_number}.pdf`;
  const mediaId = await uploadMedia(buffer, filename, 'application/pdf');

  if (mediaId) {
    await sendDocument(phone, mediaId, filename, `Quote #${quote.quote_number}`);
  } else {
    await sendText(phone, "Sorry, couldn't generate that PDF right now. Try again shortly.");
  }

  // Downloading doesn't end the flow -- they may still want to convert it.
  return sendReview(phone, quote);
}

async function handleConfirmConvert(conversation, quoteId) {
  const { phone } = conversation;

  // Same atomic-claim pattern as quoteBuilding.js's confirm step, and for
  // the same reason -- a slow response can lead to more than one tap on the
  // same button. Only the request that wins this update proceeds.
  const { data: claimed } = await supabase
    .from('whatsapp_conversations')
    .update({ state: 'order_converting' })
    .eq('id', conversation.id)
    .eq('state', 'order_reviewing_quote')
    .select('id')
    .maybeSingle();

  if (!claimed) {
    return {}; // lost the race -- leave state/context untouched, send nothing
  }

  const { data: customer } = await supabase
    .from('users')
    .select('email, company_name')
    .eq('id', conversation.user_id)
    .single();
  const customerLabel = customer?.company_name || customer?.email || 'A WhatsApp customer';

  const result = await convertQuoteForCustomer(conversation.user_id, customerLabel, quoteId, 'whatsapp');

  if (result.error) {
    await sendText(phone, `Couldn't convert that quote: ${result.error}`);
    return { newState: 'main_menu', newContext: {} };
  }

  // Flagged like a short portal checkout, so the order is approved
  // automatically once the stock arrives (037).
  const { data: lines } = await supabase
    .from('order_items')
    .select('quantity, products(stock_quantity)')
    .eq('order_id', result.orderId);
  const waitingForStock = (lines || []).some((l) => l.quantity > (l.products?.stock_quantity ?? 0));
  if (waitingForStock) await flagStockShort(result.orderId);

  await sendText(
    phone,
    waitingForStock
      ? `✅ Order placed from quote #${result.quoteNumber}! Some items aren't in stock yet, so your order waits until they arrive. We'll let you know when they do, and you pay then.`
      : `✅ Order placed from quote #${result.quoteNumber}! Your order still needs to be approved by our team before payment. We'll let you know as soon as that happens.`
  );
  const { sendMenu } = require('./mainMenu');
  await sendMenu(phone);
  return { newState: 'main_menu', newContext: {} };
}

async function handle(conversation, message) {
  const { phone, state, context } = conversation;
  const choice = message.interactiveId;

  if (state === 'order_selecting_quote') {
    if (!choice || !choice.startsWith('quote_')) {
      await sendText(phone, 'Please pick a quote from the list, or reply "menu" to go back.');
      return { newState: 'order_selecting_quote', newContext: {} };
    }

    const quoteId = choice.slice('quote_'.length);
    const quote = await fetchQuoteWithItems(quoteId, conversation.user_id);
    if (!quote) {
      await sendText(phone, "Sorry, that quote isn't available anymore.");
      return { newState: 'main_menu', newContext: {} };
    }

    return sendReview(phone, quote);
  }

  if (state === 'order_reviewing_quote') {
    if (choice === 'order_confirm_convert') {
      return handleConfirmConvert(conversation, context.quoteId);
    }

    if (choice === 'order_cancel') {
      await sendText(phone, 'No problem.');
      return start(conversation);
    }

    // Re-fetch for both the download path and the unrecognized-input
    // fallback -- both end up re-showing the review screen.
    const quote = await fetchQuoteWithItems(context.quoteId, conversation.user_id);
    if (!quote) {
      await sendText(phone, "Sorry, that quote isn't available anymore.");
      return { newState: 'main_menu', newContext: {} };
    }

    if (choice === 'order_download_pdf') {
      return handleDownload(phone, conversation, quote);
    }

    return sendReview(phone, quote);
  }

  const { sendMenu } = require('./mainMenu');
  await sendMenu(phone);
  return { newState: 'main_menu', newContext: {} };
}

module.exports = { start, handle, fetchQuoteWithItems };
