jest.mock('../../config/supabase', () => ({ rpc: jest.fn() }));

describe('dbClock', () => {
  let supabase;
  let dbNowMs;
  let syncDbClock;
  let _reset;
  let REFRESH_MS;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // Required *after* resetModules so the test and dbClock.js share the same
    // mock instance -- requiring it at the top of the file would hand the
    // test the pre-reset copy while dbClock got a fresh one.
    supabase = require('../../config/supabase');
    ({ dbNowMs, syncDbClock, _reset, REFRESH_MS } = require('../dbClock'));
    _reset();
  });

  // The bug this exists for: a host clock running an hour fast made every
  // fresh 60-minute reservation report as already expired.
  it('reports database time, not host time, when the host clock runs fast', async () => {
    const realNow = Date.now();
    const hostIsFastBy = 62 * 60 * 1000;
    jest.spyOn(Date, 'now').mockReturnValue(realNow + hostIsFastBy);
    supabase.rpc.mockResolvedValue({ data: new Date(realNow).toISOString(), error: null });

    const nowMs = await dbNowMs();

    expect(supabase.rpc).toHaveBeenCalledWith('db_now');
    // Within a second of real time, despite the host being an hour out.
    expect(Math.abs(nowMs - realNow)).toBeLessThan(1000);
    Date.now.mockRestore();
  });

  it('caches the offset instead of asking the database every time', async () => {
    supabase.rpc.mockResolvedValue({ data: new Date().toISOString(), error: null });

    await dbNowMs();
    await dbNowMs();
    await dbNowMs();

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('re-measures once the cached offset goes stale', async () => {
    supabase.rpc.mockResolvedValue({ data: new Date().toISOString(), error: null });
    await dbNowMs();

    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow + REFRESH_MS + 1000);
    await dbNowMs();

    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    Date.now.mockRestore();
  });

  it('shares one round trip between concurrent callers', async () => {
    supabase.rpc.mockResolvedValue({ data: new Date().toISOString(), error: null });

    await Promise.all([dbNowMs(), dbNowMs(), dbNowMs()]);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  // Migration 029 may not be applied yet. A missing db_now() must degrade to
  // the old behaviour, never break the order page it's called from.
  it('falls back to host time when the database clock cannot be read', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'function db_now() does not exist' } });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const before = Date.now();
    const nowMs = await dbNowMs();

    expect(nowMs).toBeGreaterThanOrEqual(before);
    expect(consoleError.mock.calls[0].join(' ')).toMatch(/database clock/i);
    consoleError.mockRestore();
  });

  it('survives a thrown rpc rather than rejecting', async () => {
    supabase.rpc.mockRejectedValue(new Error('network down'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(syncDbClock()).resolves.toBeUndefined();
    await expect(dbNowMs()).resolves.toEqual(expect.any(Number));

    consoleError.mockRestore();
  });

  it('warns once when the host clock is badly out, not on every call', async () => {
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow + 62 * 60 * 1000);
    supabase.rpc.mockResolvedValue({ data: new Date(realNow).toISOString(), error: null });
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await syncDbClock();
    await syncDbClock();

    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls[0].join(' ')).toMatch(/clock/i);
    consoleWarn.mockRestore();
    Date.now.mockRestore();
  });

  it('stays quiet when the clocks agree', async () => {
    supabase.rpc.mockResolvedValue({ data: new Date().toISOString(), error: null });
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await syncDbClock();

    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('ignores an unparseable timestamp instead of poisoning the offset', async () => {
    supabase.rpc.mockResolvedValue({ data: 'not-a-date', error: null });

    const before = Date.now();
    const nowMs = await dbNowMs();

    expect(nowMs).toBeGreaterThanOrEqual(before);
  });
});
