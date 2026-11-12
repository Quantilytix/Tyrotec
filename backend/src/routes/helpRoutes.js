const express = require('express');
const router = express.Router();
const { chat } = require('../controllers/helpController');
const { optionalAuth } = require('../middleware/auth');

// The Help chat (helpChatService.js): anyone, including visitors browsing
// without an account. Guests have tighter limits (helpController.js).
router.post('/chat', optionalAuth, chat);

module.exports = router;
