import { describe, expect, it, vi } from 'vitest';

import { setTrustBadge, type BadgeApi } from '../src/lib/platform/badge.js';

function fakeAction(opts: { withTextColor?: boolean; reject?: boolean } = {}) {
  const result = () =>
    opts.reject ? Promise.reject(new Error('Invalid tab ID: 7')) : Promise.resolve();
  const api = {
    setBadgeText: vi.fn(result),
    setBadgeBackgroundColor: vi.fn(result),
    ...(opts.withTextColor === false ? {} : { setBadgeTextColor: vi.fn(result) }),
  };
  return api as typeof api & BadgeApi;
}

describe('setTrustBadge', () => {
  it('danger: a red «!» on that tab only', async () => {
    const api = fakeAction();
    await setTrustBadge(7, 'danger', api);
    expect(api.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '!' });
    expect(api.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: '#b91c1c' });
    expect(api.setBadgeTextColor).toHaveBeenCalledWith({ tabId: 7, color: '#ffffff' });
  });

  it('warn: an amber «!» with dark text', async () => {
    const api = fakeAction();
    await setTrustBadge(7, 'warn', api);
    expect(api.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '!' });
    expect(api.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: '#fbbf24' });
    expect(api.setBadgeTextColor).toHaveBeenCalledWith({ tabId: 7, color: '#1a1a1a' });
  });

  it.each(['ok', 'neutral', undefined] as const)('%s clears the badge', async (tone) => {
    const api = fakeAction();
    await setTrustBadge(7, tone, api);
    expect(api.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '' });
    expect(api.setBadgeBackgroundColor).not.toHaveBeenCalled();
  });

  it('still sets the badge where setBadgeTextColor is missing', async () => {
    const api = fakeAction({ withTextColor: false });
    await setTrustBadge(7, 'danger', api);
    expect(api.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '!' });
  });

  it('swallows the rejection for a tab that closed meanwhile', async () => {
    const api = fakeAction({ reject: true });
    await expect(setTrustBadge(7, 'danger', api)).resolves.toBeUndefined();
    await expect(setTrustBadge(7, 'ok', api)).resolves.toBeUndefined();
  });

  it('defaults to browser.action', async () => {
    const api = fakeAction();
    vi.stubGlobal('browser', { action: api });
    try {
      await setTrustBadge(3, 'warn');
      expect(api.setBadgeText).toHaveBeenCalledWith({ tabId: 3, text: '!' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
