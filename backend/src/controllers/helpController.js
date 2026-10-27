const asyncHandler = require('../utils/asyncHandler');
const { answerQuestion } = require('../services/helpChatService');
const { createRateLimiter } = require('../utils/rateLimit');

// 20 questions per 10 minutes per person: plenty for a conversation, and a
// cap on what one account can cost in AI calls.
const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });

// Signed-in users. Answers the last question in `messages`
// ([{ role: 'user'|'assistant', text }]); nothing is stored.
const chat = asyncHandler(async (req, res) => {
  const allowed = limiter(req.user.id);
  if (!allowed.ok) {
    const minutes = Math.max(1, Math.ceil(allowed.retryAfterSeconds / 60));
    return res.status(429).json({ error: `You've asked a lot of questions in a short time. Please try again in about ${minutes} minute(s).` });
  }
  const result = await answerQuestion(req.body?.messages);
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.json({ answer: result.answer });
});

module.exports = { chat };
