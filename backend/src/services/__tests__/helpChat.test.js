const { htmlToText, sameSiteLinks } = require('../../utils/htmlText');
const { createRateLimiter } = require('../../utils/rateLimit');
const knowledge = require('../tyrotecKnowledge');
const { validateMessages, geminiRequest, answerQuestion } = require('../helpChatService');

const page = (title, body) => `<html><head><title>${title}</title><style>.x{}</style></head><body>${body}<script>var s=1</script></body></html>`;
const SITE = {
  'https://www.tyrotec.co.za/': page('Home', '<h1>Engineered to perform</h1><p>Spare parts &amp; repairs.</p><a href="about.html">About</a><a href="index.html">Home</a><a href="mailto:sales@tyrotec.co.za">Mail</a><a href="https://other.com/x">x</a>'),
  'https://www.tyrotec.co.za/about.html': page('About', '<h2>Who we are</h2><p>Based in Rustenburg.</p><a href="contact.html#map">Contact</a>'),
  'https://www.tyrotec.co.za/contact.html': page('Contact', '<p>Call 087 804 1426</p>'),
};
const fakeFetch = (pages) => async (url) => {
  const html = pages[url];
  return { ok: Boolean(html), headers: { get: () => 'text/html' }, text: async () => html };
};

describe('htmlToText / sameSiteLinks', () => {
  it('keeps the words and headings, drops scripts and styles, decodes entities', () => {
    const { title, text } = htmlToText(SITE['https://www.tyrotec.co.za/']);
    expect(title).toBe('Home');
    expect(text).toContain('## Engineered to perform');
    expect(text).toContain('Spare parts & repairs.');
    expect(text).not.toContain('var s');
    expect(text).not.toContain('.x{}');
  });

  it('follows only same-site pages, treating index.html as the home page', () => {
    expect(sameSiteLinks(SITE['https://www.tyrotec.co.za/'], 'https://www.tyrotec.co.za/').sort())
      .toEqual(['https://www.tyrotec.co.za/', 'https://www.tyrotec.co.za/about.html']);
  });
});

describe('tyrotecKnowledge', () => {
  beforeEach(() => knowledge.resetCache());

  it('reads the home page and every page it leads to', async () => {
    const text = await knowledge.crawlSite(fakeFetch(SITE), 'https://www.tyrotec.co.za/');
    expect(text).toContain('=== Home (https://www.tyrotec.co.za/) ===');
    expect(text).toContain('Based in Rustenburg.');
    expect(text).toContain('Call 087 804 1426');
  });

  it('falls back to the saved copy when the website is down', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const text = await knowledge.getWebsiteKnowledge({ fetchImpl: async () => { throw new Error('offline'); } });
    expect(text).toBe(knowledge.snapshotText());
    expect(text).toContain('Tyrotec');
    console.error.mockRestore();
  });
});

describe('validateMessages', () => {
  it('accepts a conversation ending with a question, starting it at the first question', () => {
    const { messages } = validateMessages([
      { role: 'assistant', text: 'Hi! How can I help?' },
      { role: 'user', text: ' Where are you based? ' },
    ]);
    expect(messages).toEqual([{ role: 'user', text: 'Where are you based?' }]);
  });

  it.each([
    [[], 'Type a question.'],
    [[{ role: 'user', text: 'x'.repeat(1001) }], 'Keep each question under 1000 characters.'],
    [[{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello' }], 'Type a question.'],
    [[{ role: 'system', text: 'Hi' }], 'Something was wrong with that message. Try again.'],
  ])('refuses %j', (messages, error) => {
    expect(validateMessages(messages).error).toBe(error);
  });
});

describe('geminiRequest / answerQuestion', () => {
  const ENV = process.env.GEMINI_API_KEY;
  afterEach(() => { process.env.GEMINI_API_KEY = ENV; });

  it('sends the rules, the portal guide and the website as the system instruction', () => {
    const body = geminiRequest([{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello' }, { role: 'user', text: 'Hours?' }], 'WEBSITE TEXT');
    const system = body.systemInstruction.parts[0].text;
    expect(system).toContain('ONLY the information below');
    expect(system).toContain('HOW THE TYROTEC CUSTOMER PORTAL WORKS');
    expect(system).toContain('WEBSITE TEXT');
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it("returns the model's answer", async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    jest.spyOn(knowledge, 'getWebsiteKnowledge');
    const fetchImpl = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'We are in Rustenburg.' }] } }] }) });
    const result = await answerQuestion([{ role: 'user', text: 'Where are you?' }], { fetchImpl });
    expect(result).toEqual({ answer: 'We are in Rustenburg.' });
  });

  it('says so politely when the AI fails or is not set up', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.GEMINI_API_KEY = 'test-key';
    const failing = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) });
    expect((await answerQuestion([{ role: 'user', text: 'Hi' }], { fetchImpl: failing })).status).toBe(502);
    delete process.env.GEMINI_API_KEY;
    expect((await answerQuestion([{ role: 'user', text: 'Hi' }])).status).toBe(503);
    console.error.mockRestore();
  });
});

describe('createRateLimiter', () => {
  it('allows N per window, then refuses until the window moves on', () => {
    const check = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(check('u', 0).ok).toBe(true);
    expect(check('u', 100).ok).toBe(true);
    const third = check('u', 200);
    expect(third.ok).toBe(false);
    expect(third.retryAfterSeconds).toBe(1);
    expect(check('other', 200).ok).toBe(true);
    expect(check('u', 1001).ok).toBe(true);
  });
});
