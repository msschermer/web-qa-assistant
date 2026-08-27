/**
 * Graceful Chrome process shutdown for AutoQA CDP sessions.
 * Playwright connectOverCDP's browser.close() disconnects; it may NOT quit Chrome.
 */
export function waitForChildExit(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    if (!child) {
      resolve({
        childExitedNaturally: false,
        forcedKill: false,
        childExitCode: null,
        waitedMs: 0,
        note: 'no-child'
      });
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({
        childExitedNaturally: true,
        forcedKill: false,
        childExitCode: child.exitCode,
        childSignal: child.signalCode,
        waitedMs: 0
      });
      return;
    }

    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve({ ...payload, waitedMs: Date.now() - started });
    };

    const onExit = (code, signal) => {
      clearTimeout(timer);
      finish({
        childExitedNaturally: true,
        forcedKill: false,
        childExitCode: code,
        childSignal: signal
      });
    };
    child.once('exit', onExit);

    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      let forced = false;
      try {
        if (child.exitCode === null && child.signalCode === null) {
          forced = true;
          child.kill();
        }
      } catch { /* ignore */ }

      const forceTimer = setTimeout(() => {
        finish({
          childExitedNaturally: false,
          forcedKill: forced,
          childExitCode: child.exitCode,
          childSignal: child.signalCode,
          note: 'forced-kill-timeout'
        });
      }, 2000);

      child.once('exit', (code, signal) => {
        clearTimeout(forceTimer);
        finish({
          childExitedNaturally: false,
          forcedKill: forced,
          childExitCode: code,
          childSignal: signal
        });
      });
    }, timeoutMs);
  });
}

/**
 * Ask Chromium to quit, then wait for the OS process to exit.
 */
export async function gracefulCloseChromeSession(session, { exitTimeoutMs = 5000 } = {}) {
  const started = Date.now();
  let shutdownMethod = 'none';
  const profileDir = session?.profileDir || null;
  const child = session?.child || null;
  const browser = session?.browser || null;

  if (browser) {
    try {
      if (typeof browser.newBrowserCDPSession === 'function') {
        const cdp = await browser.newBrowserCDPSession();
        await cdp.send('Browser.close');
        shutdownMethod = 'cdp:Browser.close';
      } else {
        await browser.close();
        shutdownMethod = 'playwright.browser.close';
      }
    } catch {
      try {
        await browser.close();
        shutdownMethod = 'playwright.browser.close-fallback';
      } catch {
        shutdownMethod = 'close-failed';
      }
    }
  }

  const browserCloseMs = Date.now() - started;
  const exit = await waitForChildExit(child, exitTimeoutMs);

  return {
    shutdownMethod,
    browserCloseMs,
    childExitedNaturally: Boolean(exit.childExitedNaturally),
    forcedKill: Boolean(exit.forcedKill),
    childExitCode: exit.childExitCode ?? null,
    childSignal: exit.childSignal ?? null,
    profileDir,
    waitedMs: exit.waitedMs,
    totalShutdownMs: Date.now() - started
  };
}
