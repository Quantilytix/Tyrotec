const asyncHandler = require('../utils/asyncHandler');
const { answerQuestion } = require('../services/helpChatService');
const { createRateLimiter } = require('../utils/rateLimit');

// 20 questions per 10 minutes per person: plenty for a conversation, and a
// cap on what one account can cost in AI calls.
const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });
// Visitors without an account are known only by their connection, so they
// get less, and all of them together share a ceiling: an anonymous page
// must not be able to run up the AI bill.
const guestLimiter = createRateLimiter({ limit: 8, windowMs: 10 * 60 * 1000 });
const allGuestsLimiter = createRateLimiter({ limit: 150, windowMs: 60 * 60 * 1000 });

function busyMessage(retryAfterSeconds) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `You've asked a lot of questions in a short time. Please try again in about ${minutes} minute(s).`;
}

// Anyone, signed in or not. Answers the last question in `messages`
// ([{ role: 'user'|'assistant', text }]); nothing is stored.
const chat = asyncHandler(async (req, res) => {
  if (req.user) {
    const allowed = limiter(req.user.id);
    if (!allowed.ok) return res.status(429).json({ error: busyMessage(allowed.retryAfterSeconds) });
  } else {
    const mine = guestLimiter(`ip:${req.ip}`);
    if (!mine.ok) return res.status(429).json({ error: busyMessage(mine.retryAfterSeconds) });
    const everyone = allGuestsLimiter('guests');
    if (!everyone.ok) {
      return res.status(429).json({
        error: 'Help is very busy right now. Please try again later, or log in to keep asking.',
      });
    }
  }
  const result = await answerQuestion(req.body?.messages);
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.json({ answer: result.answer });
});

module.exports = { chat };
