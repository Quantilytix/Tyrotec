const express = require('express');
const router = express.Router();
const { receiveItn } = require('../controllers/payfastWebhookController');


router.post('/notify', receiveItn);

module.exports = router;
