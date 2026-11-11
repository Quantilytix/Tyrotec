const express = require('express');
const router = express.Router();
const { receiveWebhook } = require('../controllers/paystackController');

// Paystack -> us. No sign-in: it's authenticated by Paystack's signature
// (paystackController.receiveWebhook). The raw body it needs is captured in
// app.js. Set this URL in Paystack: Settings -> API Keys & Webhooks.
router.post('/webhook', receiveWebhook);

module.exports = router;
