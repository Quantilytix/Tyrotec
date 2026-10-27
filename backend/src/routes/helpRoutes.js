const express = require('express');
const router = express.Router();
const { chat } = require('../controllers/helpController');
const { authenticateToken } = require('../middleware/auth');

// The Help chat (helpChatService.js): any signed-in user.
router.post('/chat', authenticateToken, chat);

module.exports = router;
