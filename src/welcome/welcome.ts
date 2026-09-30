// The first-run page (welcome.html), opened once by the install hook in
// background.ts. It makes no request: the two examples are the shared
// components painted from fictional view data below, and the only
// browser API it reads is commands.getAll() — the user's real shortcut
// keys, which needs no permission. Nothing is stored.
//
// Engine differences (the pin instruction, the side-panel command name,
// how shortcuts are changed) come from platform/engine.ts.

// Side-effect import: aliases `globalThis.browser = chrome` on Chromium
// before any `browser.*` access. Must stay the first import.
import '../lib/platform/globals.js';
import { formatOrgnr } from '../lib/format.js';
import { isFirefox } from '../lib/platform/engine.js';
import { buildAnswer } from '../lib/view/components/answer.js';
import { button, el, glyph, link, svgUse } from '../lib/view/components/dom.js';
import { buildLedger } from '../lib/view/components/ledger.js';
import { appendSiteLabel } from '../lib/view/components/masthead.js';
import { COPY, SUPPORT_EMAIL } from '../lib/view/copy.js';
import type { AnswerView, LedgerRow } from '../lib/view/trust-view.js';

const W = COPY.welcome;
const NBSP = ' ';

// --- the examples: fictional companies from the design brief ---------------

interface Example {
  tone: 'ok' | 'danger';
  host: string;
  name: string;
  orgnr: string;
  // The popup's leaders line — a normal company's line, never under a
  // stamp (trust-view.ts). It also balances the two cards: the calm
  // one carries the leaders and a fourth row, the loud one the stamp.
  leaders?: Array<{ label: string; name: string }>;
  answer: AnswerView;
  ledger: LedgerRow[];
  caption: string;
}

const row = (
  key: string,
  label: string,
  tone: LedgerRow['tone'],
  value: string,
  extra: Partial<LedgerRow> = {},
): LedgerRow => ({ key, label, tone, value, actions: [], ...extra });

const EXAMPLES: Example[] = [
  {
    tone: 'ok',
    host: 'www.nordvik.no',
    name: 'NORDVIK ENERGI ASA',
    orgnr: '912345678',
    leaders: [
      { label: COPY.dagligLeder, name: 'Ingrid Solheim' },
      { label: COPY.styreleder, name: 'Per Haugen' },
    ],
    answer: { tone: 'ok', headline: 'Ingen varsler i registeret', actions: [] },
    ledger: [
      row('kobling', 'Kobling', 'ok', 'nordvik.no er registrert hjemmeside'),
      row('status', 'Status', 'ok', 'Aktiv'),
      row('ansatte', 'Ansatte', 'neutral', `1${NBSP}240`),
      row('regnskap', 'Regnskap', 'ok', '2025 levert', {
        figures: [
          [{ text: `omsetning 68,0${NBSP}mrd`, nowrap: true }],
          [{ text: `resultat 8,8${NBSP}mrd`, nowrap: true }],
        ],
      }),
    ],
    caption: W.calm,
  },
  {
    tone: 'danger',
    host: 'solbakken-netthandel.no',
    name: 'SOLBAKKEN NETTHANDEL AS',
    orgnr: '917482551',
    answer: {
      tone: 'danger',
      headline: 'Konkurs siden 26. aug. 2026',
      supporting: 'Bostyrer: Adv. Kari Nordmann',
      stamp: { word: 'Konkurs', rest: 'siden 26. aug. 2026' },
      actions: [],
    },
    ledger: [
      row('kobling', 'Kobling', 'ok', 'Registrert hjemmeside'),
      row('status', 'Status', 'danger', 'Konkurs', { dangerValue: true }),
      row('regnskap', 'Regnskap', 'neutral', '2024', { aux: '· siste innsendte' }),
    ],
    caption: W.loud,
  },
];

// A figure: the caption is what a screen reader gets; the card itself is
// aria-hidden so no one is told a lookup happened, and it holds nothing
// focusable (the rows carry no actions).
function buildExample(ex: Example): HTMLElement {
  const fig = el('figure', 'example');
  fig.dataset.answer = ex.tone;

  const cap = el('figcaption', 'example__cap');
  const seal = el('span', 'answer__seal');
  seal.appendChild(glyph(ex.tone));
  cap.appendChild(seal);
  cap.append(ex.caption);
  fig.appendChild(cap);

  const card = el('div', 'example__card');
  card.setAttribute('aria-hidden', 'true');

  const site = el('div', 'example__site');
  site.appendChild(svgUse('mark', 'mast__mark'));
  const host = el('span', 'mast__site');
  appendSiteLabel(host, ex.host);
  site.appendChild(host);
  site.appendChild(el('span', 'evidence evidence--weak', W.exampleTag));
  card.appendChild(site);

  const ident = el('div', 'ident');
  ident.appendChild(el('p', 'ident__name', ex.name));
  const line = el('p', 'ident__line');
  line.appendChild(el('span', 'orgnr__label', COPY.orgnrLabel));
  line.appendChild(el('b', 'tnum', formatOrgnr(ex.orgnr).replace(/ /g, NBSP)));
  ident.appendChild(line);
  if (ex.leaders) {
    const leaders = el('p', 'ident__leaders');
    for (const leader of ex.leaders) {
      const pair = el('span');
      pair.append(`${leader.label} `);
      pair.appendChild(el('b', undefined, leader.name));
      leaders.appendChild(pair);
    }
    ident.appendChild(leaders);
  }
  card.appendChild(ident);

  const answer = buildAnswer(ex.answer).section;
  // An example, not an alert: nothing happened.
  answer.removeAttribute('role');
  card.appendChild(answer);
  card.appendChild(buildLedger(ex.ledger));

  fig.appendChild(card);
  return fig;
}

// --- shortcuts ---------------------------------------------------------------

interface Command {
  name?: string;
  shortcut?: string;
}

const POPUP_COMMAND = '_execute_action';
const PANEL_COMMAND = isFirefox ? '_execute_sidebar_action' : 'open-panel';

// The engines format a binding differently: «Alt+Shift+O» on both,
// «MacCtrl+Shift+O» on Firefox for macOS, «⌥⇧O» on Chrome for macOS.
const KEY_NAMES: Record<string, string> = { MacCtrl: 'Ctrl', Command: 'Cmd' };

export function shortcutKeys(shortcut: string | undefined): string[] {
  const s = shortcut?.trim() ?? '';
  if (!s) return [];
  if (s.includes('+')) return s.split('+').map((k) => KEY_NAMES[k] ?? k);
  return [...s];
}

function buildKeys(shortcut: string | undefined): HTMLElement {
  const dd = el('dd', 'keys__val');
  const keys = shortcutKeys(shortcut);
  if (keys.length === 0) {
    dd.appendChild(el('span', 'keys__unset', W.keysUnset));
    return dd;
  }
  keys.forEach((key, i) => {
    if (i > 0) {
      const plus = el('span', 'keys__plus', '+');
      plus.setAttribute('aria-hidden', 'true');
      dd.appendChild(plus);
    }
    const kbd = document.createElement('kbd');
    kbd.className = 'key';
    kbd.textContent = key;
    dd.appendChild(kbd);
  });
  return dd;
}

async function readCommands(): Promise<Command[]> {
  const api = (browser as { commands?: { getAll?: () => Promise<Command[]> } }).commands;
  try {
    return (await api?.getAll?.()) ?? [];
  } catch {
    return [];
  }
}

function openShortcutSettings(): void {
  // Chrome only: the extension may open its own shortcuts page. Firefox
  // has no URL for about:addons' shortcut editor, so the way there is
  // text (keysEditFirefox).
  void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

// --- the three ways ------------------------------------------------------------

function way(n: number, head: string): HTMLLIElement {
  const li = el('li', 'way');
  const num = el('span', 'kbd way__n', String(n));
  num.setAttribute('aria-hidden', 'true');
  li.appendChild(num);
  li.appendChild(el('h3', 'way__head', head));
  return li;
}

function buildWays(commands: Command[]): HTMLElement {
  const section = el('section', 'ways');
  const head = el('h2', 'ways__head', W.waysHead);
  head.id = 'ways-head';
  section.setAttribute('aria-labelledby', head.id);
  section.appendChild(head);
  const list = el('ol', 'ways__list');

  const toolbar = way(1, W.toolbarHead);
  toolbar.appendChild(el('p', 'way__text', isFirefox ? W.toolbarFirefox : W.toolbarChrome));
  list.appendChild(toolbar);

  const keys = way(2, W.keysHead);
  const dl = el('dl', 'keys');
  const shortcutOf = (name: string): string | undefined =>
    commands.find((c) => c.name === name)?.shortcut;
  for (const [label, name] of [
    [W.keysPopup, POPUP_COMMAND],
    [W.keysPanel, PANEL_COMMAND],
  ] as const) {
    const r = el('div', 'keys__row');
    r.appendChild(el('dt', undefined, label));
    r.appendChild(buildKeys(shortcutOf(name)));
    dl.appendChild(r);
  }
  keys.appendChild(dl);
  if (isFirefox) {
    keys.appendChild(el('p', 'way__note', W.keysEditFirefox));
  } else {
    const edit = button('text-btn way__edit', W.keysEditChrome);
    edit.addEventListener('click', openShortcutSettings);
    keys.appendChild(edit);
  }
  list.appendChild(keys);

  const menu = way(3, W.menuHead);
  menu.appendChild(el('p', 'way__text', W.menuText));
  list.appendChild(menu);

  section.appendChild(list);
  return section;
}

// --- paint -----------------------------------------------------------------------

function paintMast(mast: HTMLElement): void {
  mast.replaceChildren();
  mast.appendChild(svgUse('mark', 'mast__mark'));
  mast.appendChild(el('span', 'mast__brand', COPY.brand));
}

function paintFoot(foot: HTMLElement): void {
  foot.replaceChildren();
  const rowEl = el('div', 'foot__row');
  const attribution = el('span');
  attribution.append(COPY.attributionPre);
  attribution.appendChild(
    link(COPY.attributionLink, COPY.nlodUrl, { className: '', title: COPY.attributionTitle }),
  );
  attribution.append(COPY.attributionPost);
  rowEl.appendChild(attribution);
  const links = el('span', 'foot__links');
  links.appendChild(link(SUPPORT_EMAIL, `mailto:${SUPPORT_EMAIL}`, { className: '' }));
  links.appendChild(link(W.source, W.sourceUrl, { className: '' }));
  rowEl.appendChild(links);
  foot.appendChild(rowEl);
}

function paintMain(main: HTMLElement, commands: Command[]): void {
  main.replaceChildren();

  const hero = el('section', 'hero');
  hero.appendChild(el('h1', 'hero__head', W.head));
  hero.appendChild(el('p', 'hero__lead', W.lead));
  main.appendChild(hero);

  const examples = el('div', 'examples');
  for (const ex of EXAMPLES) examples.appendChild(buildExample(ex));
  main.appendChild(examples);

  main.appendChild(buildWays(commands));

  const privacy = el('p', 'honest privacy');
  privacy.appendChild(glyph('ok'));
  privacy.append(W.privacy);
  main.appendChild(privacy);

  main.classList.add('reveal');
}

async function init(): Promise<void> {
  paintMast(document.getElementById('mast') as HTMLElement);
  paintFoot(document.getElementById('foot') as HTMLElement);
  paintMain(document.getElementById('app') as HTMLElement, await readCommands());
}

void init();
