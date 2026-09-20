const supabase = require('../../config/supabase');
const { sendList, sendText } = require('../../config/whatsapp');
const { formatCurrency } = require('../../utils/formatCurrency');

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
    .select('id, name, sku, unit_price, vat_applicable, stock_quantity')
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
    description: `${formatCurrency(p.unit_price)} excl. VAT · ${p.stock_quantity > 0 ? `${p.stock_quantity} in stock` : 'out of stock'}`,
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
        .select('id, name, sku, description, unit_price, vat_applicable, stock_quantity')
        .eq('id', productId)
        .single();

      if (error || !product) {
        await sendText(phone, "Sorry, that product isn't available anymore.");
        return sendProductPage(phone, context.category, context.page || 0, context.purpose, context.items || []);
      }

      if (context.purpose === 'quote') {
        if (product.stock_quantity <= 0) {
          await sendText(phone, `${product.name} is currently out of stock. Pick another product, or reply "menu" to go back.`);
          return sendProductPage(phone, context.category, context.page || 0, context.purpose, context.items || []);
        }
        await sendText(phone, `${product.name} (${formatCurrency(product.unit_price)} excl. VAT). How many would you like?`);
        return {
          newState: 'quote_awaiting_quantity',
          newContext: { items: context.items || [], pendingProduct: { id: product.id, name: product.name, unit_price: product.unit_price, vat_applicable: product.vat_applicable, stock_quantity: product.stock_quantity } },
        };
      }

      // purpose 'view' -- just show details, then back to the main menu.
      await sendText(
        phone,
        `*${product.name}* (${product.sku})\n${product.description || ''}\n\nPrice: ${formatCurrency(product.unit_price)} excl. VAT\nStock: ${product.stock_quantity > 0 ? `${product.stock_quantity} available` : 'out of stock'}`
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
