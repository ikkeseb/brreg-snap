import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isForWindow,
  notifyPanel,
  PANEL_HINT_FRESH_MS,
  panelPath,
  parsePanelMessage,
  readPanelHint,
} from '../src/lib/panel-protocol.js';

const DNB = '984851006';

describe('parsePanelMessage', () => {
  it('accepts a sync with window, orgnr, host and method', () => {
    const msg = {
      type: 'sync',
      windowId: 3,
      orgnr: DNB,
      host: 'www.dnb.no',
      method: 'host-auto',
    };
    expect(parsePanelMessage(msg)).toEqual(msg);
  });

  it('accepts a no-match with or without a host', () => {
    expect(parsePanelMessage({ type: 'no-match', windowId: 3, host: 'x.no' }))
      .toEqual({ type: 'no-match', windowId: 3, host: 'x.no' });
    expect(parsePanelMessage({ type: 'no-match', windowId: 3 })).toEqual({
      type: 'no-match',
      windowId: 3,
      host: undefined,
    });
  });

  it('rejects messages without a window — they could be for any panel', () => {
    expect(
      parsePanelMessage({ type: 'sync', orgnr: DNB, method: 'url' }),
    ).toBeUndefined();
    expect(parsePanelMessage({ type: 'no-match', host: 'x.no' })).toBeUndefined();
  });

  it('rejects an invalid orgnr, an unknown method and junk', () => {
    const base = { type: 'sync', windowId: 1, method: 'url' };
    expect(parsePanelMessage({ ...base, orgnr: '984851007' })).toBeUndefined();
    expect(
      parsePanelMessage({ ...base, orgnr: DNB, method: 'guess' }),
    ).toBeUndefined();
    expect(parsePanelMessage({ ...base, orgnr: DNB, host: 42 })).toBeUndefined();
    expect(parsePanelMessage(null)).toBeUndefined();
    expect(parsePanelMessage('sync')).toBeUndefined();
    expect(parsePanelMessage({ type: 'refresh', windowId: 1 })).toBeUndefined();
  });
});

describe('isForWindow', () => {
  const msg = { type: 'no-match', windowId: 5 } as const;

  it('matches only the named window', () => {
    expect(isForWindow(msg, 5)).toBe(true);
    expect(isForWindow(msg, 6)).toBe(false);
  });

  it('takes nothing when the panel could not learn its own window', () => {
    expect(isForWindow(msg, undefined)).toBe(false);
  });
});

describe('panelPath / readPanelHint — the stamped panel-URL hint', () => {
  const now = 1_790_000_000_000;

  it('stamps an orgnr target with the open time and reads it back as fresh', () => {
    const path = panelPath({ orgnr: DNB }, now);
    expect(path).toBe(`details/details.html?orgnr=${DNB}&at=${now}`);
    const search = path.slice(path.indexOf('?'));
    expect(readPanelHint(search, now + 400)).toEqual({
      orgnr: DNB,
      nomatch: undefined,
      fresh: true,
    });
  });

  it('encodes a nomatch host', () => {
    const path = panelPath({ nomatch: 'bløtekake.no' }, now);
    const search = path.slice(path.indexOf('?'));
    expect(readPanelHint(search, now)).toMatchObject({
      nomatch: 'bløtekake.no',
      fresh: true,
    });
  });

  it('a bare panel path carries no hint', () => {
    expect(panelPath(undefined, now)).toBe('details/details.html');
    expect(readPanelHint('', now)).toEqual({
      orgnr: undefined,
      nomatch: undefined,
      fresh: false,
    });
  });

  it('a hint older than the open window is a leftover, not fresh', () => {
    const search = `?orgnr=${DNB}&at=${now}`;
    expect(readPanelHint(search, now + PANEL_HINT_FRESH_MS).fresh).toBe(true);
    expect(readPanelHint(search, now + PANEL_HINT_FRESH_MS + 1).fresh).toBe(
      false,
    );
  });

  it('an unstamped, future-stamped or junk-stamped hint is never fresh', () => {
    expect(readPanelHint(`?orgnr=${DNB}`, now).fresh).toBe(false);
    expect(readPanelHint(`?orgnr=${DNB}&at=${now + 5000}`, now).fresh).toBe(
      false,
    );
    expect(readPanelHint(`?orgnr=${DNB}&at=soon`, now).fresh).toBe(false);
  });

  it('drops an invalid orgnr and an empty nomatch', () => {
    expect(readPanelHint(`?orgnr=123&at=${now}`, now)).toEqual({
      orgnr: undefined,
      nomatch: undefined,
      fresh: false,
    });
    expect(readPanelHint(`?nomatch=&at=${now}`, now).nomatch).toBeUndefined();
  });
});

describe('notifyPanel', () => {
  afterEach(() => {
    delete (globalThis as { browser?: unknown }).browser;
  });

  it('swallows the rejection when no panel is listening', async () => {
    const sendMessage = vi.fn(() =>
      Promise.reject(new Error('Could not establish connection')),
    );
    (globalThis as { browser?: unknown }).browser = {
      runtime: { sendMessage },
    };
    const msg = { type: 'no-match', windowId: 1, host: 'x.no' } as const;
    await expect(notifyPanel(msg)).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith(msg);
  });
});
