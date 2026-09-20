const supabase = require('../../config/supabase');
const { sendText, sendButtons } = require('../../config/whatsapp');
const { formatCurrency } = require('../../utils/formatCurrency');
const { documentTotals, rateForProduct } = require('../../utils/vat');
const { createQuoteForCustomer } = require('../quoteService');

const REVIEW_BUTTONS = [
  { id: 'quote_add_more', title: 'Add another' },
  { id: 'quote_confirm', title: 'Confirm & save' },
  { id: 'quote_cancel', title: 'Cancel' },
];

function addItem(items, product, quantity) {
  const existing = items.find((i) => i.product_id === product.id);
  if (existing) {
    return items.map((i) => (i.product_id === product.id ? { ...i, quantity: i.quantity + quantity } : i));
  }
  return [
    ...items,
    {
      product_id: product.id,
      name: product.name,
      // Excl VAT, with the product's own rate -- the same rule the portal's
      // cart uses, so the running total here matches the saved quote.
      unit_price: product.unit_price,
      vat_rate: rateForProduct(product),
      quantity,
    },
  ];
}

async function sendReview(phone, items) {
  const lines = items.map((i) => `${i.quantity}x ${i.name} · ${formatCurrency(i.unit_price * i.quantity)}`);
  const { subtotal_amount, vat_amount, total_amount } = documentTotals(items);

  await sendButtons(phone, {
    body:
      `Your quote so far:\n${lines.join('\n')}\n\n` +
      `Subtotal (excl. VAT): ${formatCurrency(subtotal_amount)}\n` +
      `VAT: ${formatCurrency(vat_amount)}\n` +
      `Total (incl. VAT): ${formatCurrency(total_amount)}\n\nWhat next?`,
    buttons: REVIEW_BUTTONS,
  });

  return { newState: 'quote_reviewing', newContext: { items } };
}

async function handle(conversation, message) {
  const { phone, state, context } = conversation;

  if (state === 'quote_awaiting_quantity') {
    const quantity = parseInt((message.text || '').trim(), 10);
    const product = context.pendingProduct;

    if (!Number.isInteger(quantity) || quantity < 1) {
      await sendText(phone, 'Please reply with a quantity (a whole number of at least 1).');
      return { newState: 'quote_awaiting_quantity', newContext: context };
    }
    if (quantity > product.stock_quantity) {
      await sendText(phone, `Only ${product.stock_quantity} of ${product.name} available. Please enter a smaller quantity.`);
      return { newState: 'quote_awaiting_quantity', newContext: context };
    }

    const items = addItem(context.items || [], product, quantity);
    return sendReview(phone, items);
  }

  if (state === 'quote_reviewing') {
    const choice = message.interactiveId;

    if (choice === 'quote_add_more') {
      return require('./productBrowsing').startCategoryList(phone, 'quote', context.items || []);
    }

    if (choice === 'quote_confirm') {
      if (!context.items || context.items.length === 0) {
        await sendText(phone, "You haven't added any products yet.");
        return require('./productBrowsing').startCategoryList(phone, 'quote', []);
      }

      // Atomically claim the confirmation *before* doing anything slow.
      // Wamid-based dedup (in the webhook controller) only catches Meta
      // literally resending the same message -- it does nothing for the
      // customer tapping "Confirm & save" a second time themselves because
      // the first tap felt slow (e.g. a cold-starting host). Each tap is a
      // genuinely different message, so only a guard on the *action* itself
      // stops it: this update only succeeds for whichever request gets here
      // first, while state is still 'quote_reviewing'. Every other
      // concurrent/duplicate tap matches zero rows and bails out silently
      // below, instead of creating another quote and sending another
      // "saved" reply.
      const { data: claimed } = await supabase
        .from('whatsapp_conversations')
        .update({ state: 'quote_confirming' })
        .eq('id', conversation.id)
        .eq('state', 'quote_reviewing')
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

      const result = await createQuoteForCustomer(
        conversation.user_id,
        customerLabel,
        context.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        'whatsapp'
      );

      if (result.error) {
        await sendText(phone, `Sorry, couldn't save that quote: ${result.error}`);
        return { newState: 'main_menu', newContext: {} };
      }

      await sendText(
        phone,
        `✅ Quote #${result.quoteNumber} saved! Total: ${formatCurrency(result.total_amount)}. Reply "menu" any time. Pick "Convert quote to order" when you're ready to order this.`
      );
      const { sendMenu } = require('./mainMenu');
      await sendMenu(phone);
      return { newState: 'main_menu', newContext: {} };
    }

    if (choice === 'quote_cancel') {
      await sendText(phone, 'No problem, quote discarded.');
      const { sendMenu } = require('./mainMenu');
      await sendMenu(phone);
      return { newState: 'main_menu', newContext: {} };
    }

    return sendReview(phone, context.items || []);
  }

  const { sendMenu } = require('./mainMenu');
  await sendMenu(phone);
  return { newState: 'main_menu', newContext: {} };
}

module.exports = { handle };
