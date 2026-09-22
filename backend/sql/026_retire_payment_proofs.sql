-- Retires the customer-facing proof-of-payment upload.
--
-- Customers no longer declare their own bank transfers: they pay through
-- PayFast, and any other payment is recorded by a staff member who has seen
-- the money land in the bank. Nothing writes to this bucket any more, and
-- nothing reads proof_url.
--
-- The bucket was created public, which means every file ever uploaded to it
-- is readable by anyone who knows or guesses the URL -- bank confirmations
-- carrying account numbers among them. Making it private closes that off
-- without destroying anything: existing files stay, reachable through the
-- service role if a historical payment is ever queried.
--
-- Safe to run more than once.

update storage.buckets set public = false where id = 'payment-proofs';

-- payments.proof_url is deliberately left in place. Rows written before this
-- change still reference their uploads, and dropping the column would lose
-- that link for no gain; new rows simply leave it null.

-- Verification: expects one row, public = false.
-- select id, public from storage.buckets where id = 'payment-proofs';
