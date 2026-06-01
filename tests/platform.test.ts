// Coverage for the platform layer introduced by the Chrome port:
//   - globals.ts: aliases globalThis.browser = chrome on Chromium only
//   - sidebar.ts: feature-detects sidebarAction (Firefox) vs sidePanel
//     (Chrome) at module load and dispatches accordingly
//
// Both modules read the `browser` / `chrome` globals at evaluation time,
// so each case installs the globals first, then dynamic-imports under
// vi.resetModules() (same discipline as background-module.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const g = globalThis as { browser?: unknown; chrome?: unknown };

function clearGlobals(): void {
  delete g.browser;
  delete g.chrome;
}

beforeEach(() => {
  vi.resetModules();
  clearGlobals();
});

afterEach(() => {
  clearGlobals();
});

describe('platform/globals — browser/chrome aliasing', () => {
  it('aliases globalThis.browser to chrome when only chrome exists (Chromium)', async () => {
    const chrome = { runtime: { id: 'chromium' } };
    g.chrome = chrome;
    // browser intentionally undefined
    await import('../src/lib/platform/globals.js');
    expect(g.browser).toBe(chrome);
  });

  it('leaves an existing browser untouched (Firefox defines both)', async () => {
    const browser = { runtime: { id: 'firefox' } };
    const chrome = { runtime: { id: 'chromium' } };
    g.browser = browser;
    g.chrome = chrome;
    await import('../src/lib/platform/globals.js');
    expect(g.browser).toBe(browser);
  });

  it('is a no-op when neither global exists', async () => {
    await import('../src/lib/platform/globals.js');
    expect(g.browser).toBeUndefined();
  });
});

describe('platform/engine — isFirefox detection', () => {
  it('is true when sidebarAction is present (Firefox)', async () => {
    g.browser = { sidebarAction: {}, runtime: {} };
    const { isFirefox } = await import('../src/lib/platform/engine.js');
    expect(isFirefox).toBe(true);
  });

  it('is false on Chromium (browser aliased to chrome, no sidebarAction)', async () => {
    const chrome = { sidePanel: {}, runtime: {} };
    g.chrome = chrome;
    g.browser = chrome;
    const { isFirefox } = await import('../src/lib/platform/engine.js');
    expect(isFirefox).toBe(false);
  });
});

describe('platform/sidebar — Firefox (sidebarAction) branch', () => {
  function installFirefox() {
    const setPanel = vi.fn(() => Promise.resolve());
    const open = vi.fn(() => Promise.resolve());
    const isOpen = vi.fn(() => Promise.resolve(true));
    const getURL = vi.fn((p: string) => `moz-extension://test/${p}`);
    g.browser = {
      sidebarAction: { setPanel, open, isOpen },
      runtime: { getURL },
    };
    return { setPanel, open, isOpen, getURL };
  }

  it('setPanel resolves the relative path via runtime.getURL', async () => {
    const m = installFirefox();
    const { sidebar } = await import('../src/lib/platform/sidebar.js');
    sidebar.setPanel('details/details.html?orgnr=984851006');
    expect(m.getURL).toHaveBeenCalledWith(
      'details/details.html?orgnr=984851006',
    );
    expect(m.setPanel).toHaveBeenCalledWith({
      panel: 'moz-extension://test/details/details.html?orgnr=984851006',
    });
  });

  it('open ignores the target and calls sidebarAction.open()', async () => {
    const m = installFirefox();
    const { sidebar } = await import('../src/lib/platform/sidebar.js');
    sidebar.open({ windowId: 3, tabId: 7 });
    expect(m.open).toHaveBeenCalledTimes(1);
    expect(m.open).toHaveBeenCalledWith();
  });

  it('isOpen delegates to sidebarAction.isOpen', async () => {
    const m = installFirefox();
    const { sidebar } = await import('../src/lib/platform/sidebar.js');
    await expect(sidebar.isOpen()).resolves.toBe(true);
    expect(m.isOpen).toHaveBeenCalledWith({});
  });
});

describe('platform/sidebar — Chrome (sidePanel) branch', () => {
  function installChrome() {
    const setOptions = vi.fn(() => Promise.resolve());
    const open = vi.fn(() => Promise.resolve());
    const chrome = { sidePanel: { setOptions, open } };
    // Post-shim Chromium state: browser === chrome, no sidebarAction.
    g.chrome = chrome;
    g.browser = chrome;
    return { setOptions, open };
  }

  it('setPanel calls sidePanel.setOptions with the relative path, enabled', async () => {
    const m = installChrome();
    const { sidebar } = await import('../src/lib/platform/sidebar.js');
    sidebar.setPanel('details/details.html?orgnr=984851006');
    expect(m.setOptions).toHaveBeenCalledWith({
      path: 'details/details.html?orgnr=984851006',
      enabled: true,
    });
  });

  it('open prefers windowId (global panel)', async () => {
    const m = installChrome();
    const { sidebar } = await import('../src/lib/platform/sidebar.js');
    sidebar.open({ windowId: 5, tabId: 9 });
    expect(m.open).toHaveBeenCalledWith({ windowId: 5 });
  });

  it('open falls back to tabId when no windowId', async () => {
    const m = installChrome();
    const { sidebar } = await import('../src/lib/platform/sidebar.js');
    sidebar.open({ tabId: 9 });
    expect(m.open).toHaveBeenCalledWith({ tabId: 9 });
  });

  it('open is a no-op when neither windowId nor tabId is given', async () => {
    const m = installChrome();
    const { sidebar } = await import('../src/lib/platform/sidebar.js');
    sidebar.open({});
    expect(m.open).not.toHaveBeenCalled();
  });

  it('isOpen optimistically resolves true (Chrome has no query API)', async () => {
    installChrome();
    const { sidebar } = await import('../src/lib/platform/sidebar.js');
    await expect(sidebar.isOpen()).resolves.toBe(true);
  });
});
