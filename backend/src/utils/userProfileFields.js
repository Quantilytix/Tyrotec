// Single source of truth for "what a user profile looks like when sent to
// the client" -- authController.js builds this shape from five different
// places (register/login/oauthComplete x2/updateMe) plus middleware/auth.js
// (every authenticated request's req.user). Before this existed, they'd
// drifted: login() was missing full_name and phone entirely, so the user
// object a customer got right after logging in was a strict subset of what
// they got from registering or refreshing the page -- exactly the kind of
// bug that's invisible until a specific field happens to be blank on a
// specific screen.
const PROFILE_FIELDS =
  'id, email, company_name, full_name, role, status, phone, vat_number, is_vat_registered, address, can_order_on_account';

module.exports = { PROFILE_FIELDS };
