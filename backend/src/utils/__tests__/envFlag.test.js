const { isEnabled } = require('../envFlag');

describe('isEnabled', () => {
  it('accepts the obvious yes values', () => {
    for (const value of ['true', 'TRUE', 'True', '1', 'yes', 'on']) {
      expect(isEnabled(value)).toBe(true);
    }
  });

  // The case that actually bit us: a value typed into a hosting dashboard as
  // "KEY = true" stores the space, and a strict comparison reads it as off.
  it('ignores surrounding whitespace', () => {
    expect(isEnabled(' true')).toBe(true);
    expect(isEnabled('true ')).toBe(true);
    expect(isEnabled('  TRUE  ')).toBe(true);
  });

  it('treats anything else as off', () => {
    for (const value of ['false', 'no', '0', 'off', '', '   ', undefined, null, 'maybe']) {
      expect(isEnabled(value)).toBe(false);
    }
  });
});
