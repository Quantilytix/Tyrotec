// How the customer portal works, in plain words, for the Help chat
// (helpChatService.js). Keep this in step with the portal when its
// customer-facing behaviour changes.

const PORTAL_GUIDE = `
HOW THE TYROTEC CUSTOMER PORTAL WORKS

Finding products
- The Products page lists the catalogue: search by name or SKU, or pick a category. The page picker at the bottom moves between pages.
- Each product shows its price excluding VAT and whether it is in stock. Click a photo to see it full size.
- When products are on discount, a banner says how many; "View deals" or the "Deals only" button shows only those, with the new price, the old price crossed out and the reason for the discount.

Quotes
- Set a quantity and click "Add to quote". Products that are out of stock can still be added: the card says how long they usually take to arrive.
- The Quote builder (cart) lists what has been added. "Request quote" saves it as a quote and empties the builder; "Download PDF" gives a copy.
- Saved quotes are under Quotes. A quote that hasn't been ordered can be changed with "Edit quote": change quantities, remove products or add new ones. Saving prices the whole quote at today's prices, including any current discounts.
- If a discount on a quote has ended, the quote can't be ordered as it is; "Get an updated quote" makes a new one at today's prices.
- Tyrotec staff can also prepare a quote for a customer, sometimes with a discount on a line; it appears under the customer's Quotes.

Ordering
- On a quote, "Accept & order" turns it into an order.
- If everything is in stock, the stock is held for the customer for 60 minutes while they pay. If payment isn't made in that time, the order is cancelled and the stock released.
- If something isn't in stock, the order waits for it (status "Awaiting approval"). The customer is told when it should arrive and is notified when it does. The stock is then set aside and the customer has 3 days to pay; after that it goes to the next customer.

Paying
- Customers pay with the "Pay now" button on the order, which opens PayFast. On PayFast's page they can pay by card or Instant EFT.
- Some business accounts are set up to pay on invoice; they also see "Pay on invoice".
- A receipt can be downloaded from a paid order.

Orders, notifications and account
- Orders lists every order with its status: Awaiting approval, Awaiting payment, Paid, Ready for collection, Completed or Cancelled.
- Notifications shows updates about quotes and orders; the same updates are emailed.
- Profile holds the account's contact details.
- Ordering can also be done on WhatsApp if a phone number is linked to the account.

Things the portal can't tell from here
- Exact delivery dates for out-of-stock items, special pricing, returns, warranty claims and technical advice: the customer should contact Tyrotec directly.
`.trim();

module.exports = { PORTAL_GUIDE };
