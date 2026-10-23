const supabase = require('../../config/supabase');
const { sendList, sendText } = require('../../config/whatsapp');
const { formatCurrency } = require('../../utils/formatCurrency');
const { availabilityNote } = require('../../utils/availability');
const { productDiscount, discountedPrice, discountLabel } = require('../../utils/discounts');

const DISCOUNT_COLUMNS = 'discount_id, discount_percent, discount_reason, discount_ends_on';

// What the customer pays now (excl. VAT), and its discount when it has one.
function currentPrice(product) {
  const discount = productDiscount(product);
  return discount ? discountedPrice(product.unit_price, discount.percent) : Number(product.unit_price);
}

function priceText(product) {
  const discount = productDiscount(product);
  if (!discount) return `${formatCurrency(product.unit_price)} excl. VAT`;
  return `${formatCurrency(currentPrice(product))} excl. VAT, ${discountLabel(discount.percent, discount.reason)} (was ${formatCurrency(product.unit_price)})`;
}

// WhatsApp interactive lists cap at 10 rows total. Categories currently fit
// in one screen (10 seeded categories), so those aren't paginated -- but a
// single category's products can exceed that, so PAGE_SIZE reserves one row
// for "Next page" whenever there's more than a page's worth.
const PAGE_SIZE = 9;

async function startCategoryList(phone, purpose, items = []) {
  const { data: products, error } = await supabase.from('products').select('category');
  if (error) {
    await sendText(phone, 'Sorry, something went wrong loading the catalog. Try again shortly.');
    return { newState: 'main_menu', newContext: {} };
  }

  const categories = [...new Set(products.map((p) => p.category))].slice(0, 10);

  await sendList(phone, {
    header: purpose === 'quote' ? 'Build a quotation' : 'Product catalog',
    body: 'Pick a category to browse:',
    buttonText: 'Categories',
    sections: [{ title: 'Categories', rows: categories.map((c) => ({ id: `cat_${c}`, title: c.slice(0, 24) })) }],
  });

  return { newState: 'browsing_category', newContext: { purpose, items } };
}

async function sendProductPage(phone, category, page, purpose, items = []) {
  const { data: products, error } = await supabase
    .from('products')
    .select(`id, name, sku, unit_price, vat_applicable, stock_quantity, ${DISCOUNT_COLUMNS}`)
    .eq('category', category)
    .order('name', { ascending: true });

  if (error || !products.length) {
    await sendText(phone, 'No products found in that category. Reply "menu" to go back.');
    return { newState: 'main_menu', newContext: {} };
  }

  const pageItems = products.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasNext = products.length > (page + 1) * PAGE_SIZE;

  const rows = pageItems.map((p) => ({
    id: `prod_${p.id}`,
    title: p.name.slice(0, 24),
    description: `${formatCurrency(currentPrice(p))} excl. VAT${productDiscount(p) ? ` (${Number(p.discount_percent)}% off)` : ''} · ${p.stock_quantity > 0 ? `${p.stock_quantity} in stock` : 'out of stock'}`,
  }));
  if (hasNext) rows.push({ id: 'page_next', title: 'Next page →' });

  await sendList(phone, {
    header: category,
    body: purpose === 'quote' ? 'Pick a product to add to your quote:' : 'Pick a product to view:',
    buttonText: 'Products',
    sections: [{ title: category, rows }],
  });

  return { newState: 'browsing_product', newContext: { purpose, category, page, items } };
}

async function handle(conversation, message) {
  const { phone, state, context } = conversation;
  const choice = message.interactiveId;

  if (state === 'browsing_category') {
    if (!choice || !choice.startsWith('cat_')) {
      await sendText(phone, 'Please pick a category from the list, or reply "menu" to go back.');
      return { newState: 'browsing_category', newContext: context };
    }
    const category = choice.slice('cat_'.length);
    return sendProductPage(phone, category, 0, context.purpose, context.items || []);
  }

  if (state === 'browsing_product') {
    if (choice === 'page_next') {
      return sendProductPage(phone, context.category, (context.page || 0) + 1, context.purpose, context.items || []);
    }
    if (choice && choice.startsWith('prod_')) {
      const productId = choice.slice('prod_'.length);
      const { data: product, error } = await supabase
        .from('products')
        .select(`id, name, sku, description, unit_price, vat_applicable, stock_quantity, lead_time_days, ${DISCOUNT_COLUMNS}`)
        .eq('id', productId)
        .single();

      if (error || !product) {
        await sendText(phone, "Sorry, that product isn't available anymore.");
        return sendProductPage(phone, context.category, context.page || 0, context.purpose, context.items || []);
      }

      if (context.purpose === 'quote') {
        // Out of stock can still be quoted: an order for it waits until the
        // stock arrives. The customer is told up front.
        const note = availabilityNote(product.stock_quantity, 1, product.lead_time_days);
        await sendText(
          phone,
          `${product.name} (${priceText(product)}).${note ? ` ${note}` : ''} How many would you like?`
        );
        return {
          newState: 'quote_awaiting_quantity',
          newContext: {
            items: context.items || [],
            pendingProduct: {
              id: product.id,
              name: product.name,
              // What they pay now, for the running total; the saved quote is
              // priced again by the server either way.
              unit_price: currentPrice(product),
              vat_applicable: product.vat_applicable,
              stock_quantity: product.stock_quantity,
              lead_time_days: product.lead_time_days,
            },
          },
        };
      }

      // purpose 'view' -- just show details, then back to the main menu.
      await sendText(
        phone,
        `*${product.name}* (${product.sku})\n${product.description || ''}\n\nPrice: ${priceText(product)}\nStock: ${product.stock_quantity > 0 ? `${product.stock_quantity} available` : 'out of stock'}`
      );
      const { sendMenu } = require('./mainMenu');
      await sendMenu(phone, 'Reply "menu" any time to come back here. What next?');
      return { newState: 'main_menu', newContext: {} };
    }

    await sendText(phone, 'Please pick a product from the list, or reply "menu" to go back.');
    return { newState: 'browsing_product', newContext: context };
  }

  const { sendMenu } = require('./mainMenu');
  await sendMenu(phone);
  return { newState: 'main_menu', newContext: {} };
}

module.exports = { startCategoryList, handle };
