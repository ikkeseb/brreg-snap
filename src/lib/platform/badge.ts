// Per-tab toolbar badge: a glyph on the brreg-snap button when the company
// resolved for that tab has something worth a look, so the warning is
// visible before the user clicks. The surfaces call setTrustBadge after
// a lookup, with the answer's tone and the tab they resolved.
//
// No permission on either engine: action.setBadgeText /
// setBadgeBackgroundColor / setBadgeTextColor need only the manifest's
// `action` key (MDN action.setBadgeText; Chrome action API). A per-tab
// value is dropped by the browser when the tab navigates to another
// document or closes, so a badge never outlives the page it was set
// for (Chromium: ExtensionActionRunner::DidFinishNavigation clears all
// per-tab action values; Firefox resets them on location change).
//
// The badge has room for about one glyph: the tone's own TONE_GLYPH
// (danger «✕», warn «!»), so tone never rests on colour alone; the
// colour (red / amber) repeats it. The words live in the surfaces,
// which the badge only invites you to open.

import { TONE_GLYPH, type Tone } from '../trust/types.js';

interface BadgeStyle {
  text: string;
  background: string;
  color: string;
}

// The light theme's --danger (brreg.css) behind white, and the dark
// theme's --warn amber behind near-black: both well above 4.5:1.
const BADGE: Partial<Record<Tone, BadgeStyle>> = {
  danger: { text: TONE_GLYPH.danger, background: '#b91c1c', color: '#ffffff' },
  warn: { text: TONE_GLYPH.warn, background: '#fbbf24', color: '#1a1a1a' },
};

// The slice of browser.action this uses; tests pass a fake.
export interface BadgeApi {
  setBadgeText(details: { tabId: number; text: string }): Promise<void>;
  setBadgeBackgroundColor(details: {
    tabId: number;
    color: string;
  }): Promise<void>;
  // Firefox 63+, Chrome 110+ — both below the manifests' minimums, but
  // optional here so a missing method never costs the badge itself.
  setBadgeTextColor?(details: { tabId: number; color: string }): Promise<unknown>;
}

// danger → red «✕», warn → amber «!», ok / neutral / undefined (no
// company, lookup failed) → cleared. Best-effort: a tab that closed
// meanwhile makes the calls reject, and that is swallowed.
export async function setTrustBadge(
  tabId: number,
  tone: Tone | undefined,
  api: BadgeApi = browser.action,
): Promise<void> {
  const style = tone ? BADGE[tone] : undefined;
  try {
    if (!style) {
      await api.setBadgeText({ tabId, text: '' });
      return;
    }
    await Promise.all([
      api.setBadgeBackgroundColor({ tabId, color: style.background }),
      api.setBadgeTextColor?.({ tabId, color: style.color }),
      api.setBadgeText({ tabId, text: style.text }),
    ]);
  } catch {
    // The tab is gone; so is its badge.
  }
}
