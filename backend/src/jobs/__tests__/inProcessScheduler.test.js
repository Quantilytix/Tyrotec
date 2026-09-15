jest.mock('../warnExpiringReservations', () => ({ run: jest.fn() }));
jest.mock('../releaseExpiredReservations', () => ({ run: jest.fn() }));

const warnExpiringReservations = require('../warnExpiringReservations');
const releaseExpiredReservations = require('../releaseExpiredReservations');
const { startInProcessJobs } = require('../inProcessScheduler');

// Lets pending promise callbacks (the awaited job runs) settle between timer
// advances.
const flush = () => new Promise((resolve) => jest.requireActual('timers').setImmediate(resolve));

describe('startInProcessJobs', () => {
  let stop;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    warnExpiringReservations.run.mockResolvedValue();
    releaseExpiredReservations.run.mockResolvedValue();
  });

  afterEach(() => {
    stop?.();
    jest.useRealTimers();
  });

  it('runs nothing until the first-run delay, then warns before releasing', async () => {
    const order = [];
    warnExpiringReservations.run.mockImplementation(async () => order.push('warn'));
    releaseExpiredReservations.run.mockImplementation(async () => order.push('release'));

    stop = startInProcessJobs({ intervalMs: 60000, firstRunDelayMs: 1000 });
    jest.advanceTimersByTime(999);
    await flush();
    expect(warnExpiringReservations.run).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await flush();
    expect(order).toEqual(['warn', 'release']);
  });

  it('repeats on every interval', async () => {
    stop = startInProcessJobs({ intervalMs: 60000, firstRunDelayMs: 1000 });
    jest.advanceTimersByTime(1000);
    await flush();
    jest.advanceTimersByTime(60000);
    await flush();
    jest.advanceTimersByTime(60000);
    await flush();
    expect(releaseExpiredReservations.run).toHaveBeenCalledTimes(3);
  });

  it('skips a tick while the previous run is still in progress', async () => {
    let finishWarn;
    warnExpiringReservations.run.mockImplementationOnce(() => new Promise((resolve) => { finishWarn = resolve; }));

    stop = startInProcessJobs({ intervalMs: 1000, firstRunDelayMs: 1000 });
    jest.advanceTimersByTime(1000); // first run starts and hangs in warn
    await flush();
    jest.advanceTimersByTime(3000); // three more ticks arrive while it's stuck
    await flush();
    expect(warnExpiringReservations.run).toHaveBeenCalledTimes(1);

    finishWarn();
    await flush();
    expect(releaseExpiredReservations.run).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000); // next tick runs normally again
    await flush();
    expect(warnExpiringReservations.run).toHaveBeenCalledTimes(2);
  });

  it('keeps running after a job throws', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnExpiringReservations.run.mockRejectedValueOnce(new Error('supabase down'));

    stop = startInProcessJobs({ intervalMs: 1000, firstRunDelayMs: 1000 });
    jest.advanceTimersByTime(1000);
    await flush();
    expect(consoleError).toHaveBeenCalled();
    expect(releaseExpiredReservations.run).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    await flush();
    expect(releaseExpiredReservations.run).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('stop() prevents any further runs', async () => {
    stop = startInProcessJobs({ intervalMs: 1000, firstRunDelayMs: 1000 });
    stop();
    jest.advanceTimersByTime(10000);
    await flush();
    expect(warnExpiringReservations.run).not.toHaveBeenCalled();
  });
});
