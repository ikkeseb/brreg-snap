// How the popup and the context menu (background) address the panel
// (details.ts): the runtime messages that repaint an open panel, and
// the panel-URL hint that tells a freshly opened one what to show.
//
// Both halves exist because of how the panel is reached:
//
//   - runtime.sendMessage reaches EVERY extension page, and Firefox
//     sidebars / Chrome side panels are one document per browser
//     window. So every message names its target window, and the panel
//     drops messages meant for another window.
//   - sidebar.setPanel sets the GLOBAL panel URL (both engines), and
//     that URL outlives the open it was set for. So the URL carries a
//     timestamp: a hint written moments ago by a deliberate open wins,
//     a leftover one is only a fallback for when the panel can't read
//     the active tab (see panel-follow.ts § chooseStart).
//   - The global URL also reaches other windows: Firefox keeps one
//     panel URL per extension, and a global setPanel reloads an open
//     sidebar in the first window it checks, which need not be the
//     window the open was for. So the URL names its window too, and a
//     panel in any other window reads it as no hint at all.

import { isValidOrgnr } from './mod11.js';
import type { ResolutionMethod } from './ui/resolve-tab.js';

export type PanelMessage =
  | {
      type: 'sync';
      windowId: number;
      orgnr: string;
      host?: string;
      // How the sender resolved the orgnr — drives the panel's
      // «Feil bedrift?» visibility exactly as it does on the sender.
      method: ResolutionMethod;
    }
  | {
      // The sender landed on a page it couldn't resolve from the URL
      // alone. The panel re-runs the picker-aware host search itself.
      type: 'no-match';
      windowId: number;
      host?: string;
    };

const METHODS: readonly ResolutionMethod[] = [
  'host-auto',
  'host-pick',
  'url',
  'manual',
  'drill-in',
];

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

// Receiver-side guard. Anything malformed is ignored rather than
// half-applied.
export function parsePanelMessage(msg: unknown): PanelMessage | undefined {
  if (typeof msg !== 'object' || msg === null) return undefined;
  const m = msg as Record<string, unknown>;
  if (typeof m.windowId !== 'number' || !optionalString(m.host)) {
    return undefined;
  }
  if (m.type === 'no-match') {
    return { type: 'no-match', windowId: m.windowId, host: m.host };
  }
  if (
    m.type === 'sync' &&
    typeof m.orgnr === 'string' &&
    isValidOrgnr(m.orgnr) &&
    METHODS.includes(m.method as ResolutionMethod)
  ) {
    return {
      type: 'sync',
      windowId: m.windowId,
      orgnr: m.orgnr,
      host: m.host,
      method: m.method as ResolutionMethod,
    };
  }
  return undefined;
}

// A panel that couldn't learn its own window can't tell whose message
// this is, so it takes none — showing another window's company is
// worse than missing a repaint.
export function isForWindow(
  msg: PanelMessage,
  panelWindowId: number | undefined,
): boolean {
  return panelWindowId !== undefined && msg.windowId === panelWindowId;
}

export async function notifyPanel(msg: PanelMessage): Promise<void> {
  try {
    await browser.runtime.sendMessage(msg);
  } catch {
    // No panel listening (closed, or still loading) — sendMessage
    // rejects. Expected: a panel opened by the same gesture reads the
    // URL hint instead.
  }
}

// --- panel URL hint --------------------------------------------------

export type PanelTarget = { orgnr: string } | { nomatch: string } | undefined;

// How long a hint counts as "just written by the open that loaded
// this panel". A sidebar/side panel loads well within a second of the
// click; the margin covers a slow cold start. Past this, the hint is
// a leftover from an earlier open.
export const PANEL_HINT_FRESH_MS = 10_000;

const PANEL_PAGE = 'details/details.html';

// Extension-root-relative path for sidebar.setPanel. Build it inside
// the gesture that opens the panel so the stamp is the open's time.
// `windowId` is the window being opened in; leave it out only for a
// link that may open anywhere (the popup's plain href).
export function panelPath(
  target: PanelTarget,
  now: number,
  windowId?: number,
): string {
  if (!target) return PANEL_PAGE;
  const params = new URLSearchParams();
  if ('orgnr' in target) params.set('orgnr', target.orgnr);
  else params.set('nomatch', target.nomatch);
  params.set('at', String(now));
  if (windowId !== undefined) params.set('w', String(windowId));
  return `${PANEL_PAGE}?${params.toString()}`;
}

export interface PanelHint {
  orgnr?: string;
  nomatch?: string;
  // True only when a deliberate open stamped this URL moments ago.
  fresh: boolean;
}

export function readPanelHint(
  search: string,
  now: number,
  panelWindowId: number | undefined,
): PanelHint {
  const params = new URLSearchParams(search);
  // A hint for another window is none at all, fresh or not: it names
  // that window's company. As with isForWindow, a panel that couldn't
  // learn its own window takes no hint that names one.
  const w = params.get('w');
  if (w !== null && (panelWindowId === undefined || w !== String(panelWindowId))) {
    return { fresh: false };
  }
  const orgnrParam = params.get('orgnr');
  const orgnr =
    orgnrParam && isValidOrgnr(orgnrParam) ? orgnrParam : undefined;
  const nomatch = params.get('nomatch') || undefined;
  const at = Number(params.get('at'));
  const age = now - at;
  const fresh =
    (orgnr !== undefined || nomatch !== undefined) &&
    params.has('at') &&
    Number.isFinite(at) &&
    age >= 0 &&
    age <= PANEL_HINT_FRESH_MS;
  return { orgnr, nomatch, fresh };
}
