// @vitest-environment happy-dom
//
// The shared view components (src/lib/view/components/) against a real
// DOM: what each paints from its slice of the view model, and the a11y
// contract — role="alert" on the danger stamp only, sr-only tone text
// per ledger row, one live region, the copy button's label and live
// message, picker digit keys scoped to the picker, tab order.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Candidate } from '../src/lib/hostname-search.js';
import type { LedgerRow } from '../src/lib/view/trust-view.js';
import { buildActions } from '../src/lib/view/components/actions.js';
import {
  buildAnswer,
  buildAnswerLoading,
  buildErrorAnswer,
  renderAnswer,
} from '../src/lib/view/components/answer.js';
import { COPY_FEEDBACK_MS } from '../src/lib/view/components/copy-feedback.js';
import { appendParts, glyph, icon } from '../src/lib/view/components/dom.js';
import { renderFooter } from '../src/lib/view/components/footer.js';
import { renderIdentity } from '../src/lib/view/components/identity.js';
import { buildKonsernRow } from '../src/lib/view/components/konsern.js';
import { buildFacts, buildLedger, buildLedgerRow } from '../src/lib/view/components/ledger.js';
import { createLiveRegion, focusElement } from '../src/lib/view/components/live.js';
import { appendSiteLabel, renderMasthead } from '../src/lib/view/components/masthead.js';
import { renderPicker } from '../src/lib/view/components/picker.js';
import {
  buildEntryRow,
  renderRecents,
  buildListSection,
  renderSearchView,
  statusMarkFor,
} from '../src/lib/view/components/search.js';
import { buildSkeleton } from '../src/lib/view/components/skeleton.js';
import { COPY } from '../src/lib/view/copy.js';
import enhetDnb from './fixtures/brreg/enhet-984851006-dnb.json';
import enhetKonkurs from './fixtures/brreg/enhet-915330193-konkurs.json';

const NBSP = ' ';
const ORGNR = { digits: '923609016', spaced: `923${NBSP}609${NBSP}016` };

function copyHandlers(ok = true) {
  return {
    copy: vi.fn(async () => ok),
    announce: vi.fn(),
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('dom helpers', () => {
  it('references the inlined sprite through <use href="#…">', () => {
    const g = glyph('warn');
    expect(g.getAttribute('class')).toBe('glyph');
    expect(g.getAttribute('aria-hidden')).toBe('true');
    expect(g.querySelector('use')?.getAttribute('href')).toBe('#g-warn');
    expect(icon('i-copy', 'icon--copy').getAttribute('class')).toBe('icon icon--copy');
  });

  it('writes TextParts as text, <b>, negative and nowrap spans', () => {
    const p = document.createElement('p');
    appendParts(p, [
      { text: 'omsetning ' },
      { text: '68,0 mrd USD', strong: true, nowrap: true },
      { text: ' · resultat ' },
      { text: '-1,2 mill kr', negative: true },
    ]);
    expect(p.textContent).toBe('omsetning 68,0 mrd USD · resultat -1,2 mill kr');
    expect(p.querySelector('b.nw')?.textContent).toBe('68,0 mrd USD');
    expect(p.querySelector('.num--neg')?.textContent).toBe('-1,2 mill kr');
  });
});

describe('live region + focus', () => {
  it('is one polite sr-only region, and a repeat announces again', async () => {
    vi.useFakeTimers();
    const live = createLiveRegion();
    expect(live.el.getAttribute('aria-live')).toBe('polite');
    expect(live.el.className).toBe('sr-only');
    live.announce('Org.nr kopiert');
    expect(live.el.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(0);
    expect(live.el.textContent).toBe('Org.nr kopiert');
    live.announce('Org.nr kopiert');
    expect(live.el.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(0);
    expect(live.el.textContent).toBe('Org.nr kopiert');
  });

  it('focuses a heading through tabindex=-1 and leaves buttons alone', () => {
    const h1 = document.createElement('h1');
    const btn = document.createElement('button');
    document.body.append(h1, btn);
    focusElement(h1);
    expect(h1.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(h1);
    focusElement(btn);
    expect(btn.hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).toBe(btn);
  });
});

describe('masthead', () => {
  it('popup: mark, host with the registrable domain in <b>, search button', () => {
    const header = document.createElement('header');
    const onSearch = vi.fn();
    const mast = renderMasthead(header, { kind: 'popup', host: 'nettbank.dnb.no', search: true }, { onSearch });
    const mark = header.querySelector('svg.mast__mark')!;
    expect(mark.getAttribute('role')).toBe('img');
    expect(mark.getAttribute('aria-label')).toBe('brreg-snap');
    const site = header.querySelector('.mast__site')!;
    expect(site.textContent).toBe('nettbank.dnb.no');
    expect(site.querySelector('b')?.textContent).toBe('dnb.no');
    mast.searchButton!.click();
    expect(onSearch).toHaveBeenCalledOnce();
    expect(mast.searchButton!.getAttribute('aria-label')).toBe(COPY.searchLabel);
  });

  it('popup without a host says so and can hide the search button', () => {
    const header = document.createElement('header');
    const mast = renderMasthead(header, { kind: 'popup', search: false });
    expect(header.querySelector('.mast__site')?.textContent).toBe(COPY.noSite);
    expect(mast.searchButton).toBeUndefined();
    expect(header.querySelector('.icon-btn')).toBeNull();
  });

  it('panel: search field + the auto-sync switch', () => {
    const header = document.createElement('header');
    const onToggleAutoSync = vi.fn();
    const mast = renderMasthead(
      header,
      { kind: 'panel', query: 'nrk', autoSync: { on: true } },
      { onToggleAutoSync },
    );
    expect(mast.input?.value).toBe('nrk');
    expect(mast.input?.type).toBe('search');
    expect(mast.toggle?.getAttribute('role')).toBe('switch');
    expect(mast.toggle?.getAttribute('aria-checked')).toBe('true');
    mast.toggle!.click();
    expect(onToggleAutoSync).toHaveBeenCalledOnce();
  });

  it.each([
    ['www.nordvik.no', 'www.', 'nordvik.no'],
    ['solbakken-netthandel.no', '', 'solbakken-netthandel.no'],
    ['WWW.BBC.CO.UK', 'www.', 'bbc.co.uk'],
    ['localhost', '', 'localhost'],
  ])('%s → «%s<b>%s</b>»', (host, pre, strong) => {
    const span = document.createElement('span');
    appendSiteLabel(span, host);
    expect(span.textContent).toBe(pre + strong);
    expect(span.querySelector('b')?.textContent).toBe(strong);
  });
});

describe('identity', () => {
  const identity = {
    name: 'EQUINOR ASA',
    claim: false,
    over: 'Allmennaksjeselskap · Stavanger',
    orgnr: ORGNR,
    brregUrl: 'https://virksomhet.brreg.no/nb/oppslag/enheter/923609016',
    leaders: [
      { label: 'Daglig leder', name: 'Kari Nordmann' },
      { label: 'Styreleder', name: 'Ola Hansen' },
    ],
    flags: '',
  };

  it('paints over · name · org.nr line · leaders', () => {
    const div = document.createElement('div');
    const { heading } = renderIdentity(div, identity, copyHandlers());
    expect(div.querySelector('.ident__over')?.textContent).toBe('Allmennaksjeselskap · Stavanger');
    expect(heading.tagName).toBe('H1');
    expect(heading.className).toBe('ident__name');
    expect(heading.textContent).toBe('EQUINOR ASA');
    const link = div.querySelector<HTMLAnchorElement>('.ident__line a.link')!;
    expect(link.href).toBe(identity.brregUrl);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect([...div.querySelectorAll('.ident__leaders span')].map((s) => s.textContent)).toEqual([
      'Daglig leder Kari Nordmann',
      'Styreleder Ola Hansen',
    ]);
  });

  it('the org.nr button copies the digits, says so, and resets after 1.4 s', async () => {
    vi.useFakeTimers();
    const div = document.createElement('div');
    const handlers = copyHandlers();
    renderIdentity(div, identity, handlers);
    const btn = div.querySelector<HTMLButtonElement>('button.orgnr')!;
    expect(btn.getAttribute('aria-label')).toBe(`Kopier org.nr ${ORGNR.spaced}`);
    expect(btn.querySelector('.orgnr__num')?.textContent).toBe(ORGNR.spaced);
    expect(btn.querySelector('.icon--copy')).not.toBeNull();
    expect(btn.querySelector('.icon--done')).not.toBeNull();
    expect(btn.querySelector('.orgnr__toast')).toBeNull();

    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(handlers.copy).toHaveBeenCalledWith('923609016');
    expect(btn.classList.contains('is-copied')).toBe(true);
    expect(handlers.announce).toHaveBeenCalledWith('Org.nr kopiert');
    await vi.advanceTimersByTimeAsync(COPY_FEEDBACK_MS);
    expect(btn.classList.contains('is-copied')).toBe(false);
  });

  it('a refused clipboard write is said in the danger tone', async () => {
    vi.useFakeTimers();
    const div = document.createElement('div');
    const handlers = copyHandlers(false);
    renderIdentity(div, identity, handlers);
    const btn = div.querySelector<HTMLButtonElement>('button.orgnr')!;
    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(btn.classList.contains('is-failed')).toBe(true);
    expect(btn.classList.contains('is-copied')).toBe(false);
    expect(handlers.announce).toHaveBeenCalledWith(COPY.copyFailedLive);
  });

  it('a spoof gets the eyebrow, the claim size, meta on the org.nr line, no over', () => {
    const div = document.createElement('div');
    renderIdentity(
      div,
      {
        ...identity,
        claim: true,
        over: undefined,
        eyebrow: 'Org.nr funnet i sidetittelen',
        meta: 'Allmennaksjeselskap · Stavanger',
        leaders: [],
        avdeling: 'Avdeling: EQUINOR ASA AVD ALTA (973 160 834)',
      },
      copyHandlers(),
    );
    expect(div.querySelector('.ident__over')).toBeNull();
    expect(div.querySelector('.ident__eyebrow')?.textContent).toBe('Org.nr funnet i sidetittelen');
    expect(div.querySelector('.ident__eyebrow use')?.getAttribute('href')).toBe('#i-link');
    expect(div.querySelector('h1')?.classList.contains('ident__name--claim')).toBe(true);
    // Amendment b: the org.nr owns its line; «form · city» takes the
    // next with the brreg.no link glued to its last word (never orphaned).
    const rest = div.querySelector('.ident__line .ident__rest')!;
    expect(rest.querySelector('.ident__meta')?.textContent).toBe('Allmennaksjeselskap · Stavanger brreg.no ↗');
    expect(rest.querySelector('.nw')?.textContent).toBe('Stavanger brreg.no ↗');
    expect(rest.querySelector('.nw a.link')).not.toBeNull();
    expect(div.querySelector('.ident__leaders')).toBeNull();
    expect(div.querySelector('.ident__note')?.textContent).toMatch(/^Avdeling: /);
  });
});

describe('answer', () => {
  it('ok: a quiet band with a seal, labelled by its heading, no alert', () => {
    const { section, heading } = buildAnswer({ tone: 'ok', headline: 'Ingen varsler i registeret', actions: [] });
    expect(section.className).toBe('answer answer--ok');
    expect(section.getAttribute('role')).toBeNull();
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(section.querySelector('.answer__seal use')?.getAttribute('href')).toBe('#g-ok');
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toBe('Ingen varsler i registeret');
    expect(section.querySelector('.answer__support')).toBeNull();
  });

  it('warn: the support line and the way out inside the band', () => {
    const onReject = vi.fn();
    const { section } = buildAnswer(
      {
        tone: 'warn',
        headline: 'Usikker kobling til bbc.co.uk',
        supporting: 'Ingen i registeret har denne hjemmesiden.',
        actions: [{ kind: 'reject', text: 'Feil bedrift? Velg en annen' }],
      },
      { onReject },
    );
    expect(section.querySelector('.answer__support')?.textContent).toBe('Ingen i registeret har denne hjemmesiden.');
    const btn = section.querySelector<HTMLButtonElement>('.answer__actions .btn--tone')!;
    expect(btn.textContent).toBe('Feil bedrift? Velg en annen');
    btn.click();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('danger: role=alert, no seal, the headline as prose around the stamp word', () => {
    const onReject = vi.fn();
    const { section, heading } = buildAnswer(
      {
        tone: 'danger',
        headline: 'Nettstedet er ikke koblet til selskapet',
        supporting: 'Registrert hjemmeside er nordvik.no. Hvem som helst kan skrive et org.nr på siden sin.',
        stamp: { pre: 'Nettstedet er', word: 'ikke koblet', rest: 'til selskapet' },
        actions: [
          { kind: 'goto', text: 'Gå til nordvik.no', href: 'https://nordvik.no' },
          { kind: 'reject', text: 'Søk etter riktig selskap' },
        ],
      },
      { onReject },
    );
    expect(section.getAttribute('role')).toBe('alert');
    expect(section.querySelector('.answer__seal')).toBeNull();
    expect(heading.textContent).toBe('Nettstedet er ikke koblet til selskapet');
    expect(heading.querySelector('.stamp-pre')?.textContent).toBe('Nettstedet er');
    expect(heading.querySelector('strong.stamp-word')?.textContent).toBe('ikke koblet');
    expect(heading.querySelector('.stamp-word use')?.getAttribute('href')).toBe('#g-danger');
    expect(heading.querySelector('.stamp-rest')?.textContent).toBe('til selskapet');
    const support = section.querySelector('.answer__support')!;
    expect(support.querySelector('b')?.textContent).toBe('nordvik.no');
    expect(support.textContent).toBe(
      'Registrert hjemmeside er nordvik.no. Hvem som helst kan skrive et org.nr på siden sin.',
    );
    const goto = section.querySelector<HTMLAnchorElement>('a.btn--on-fill')!;
    expect(goto.href).toBe('https://nordvik.no/');
    expect(goto.textContent).toBe('Gå til nordvik.no ↗');
    section.querySelector<HTMLButtonElement>('button.text-btn--on-fill')!.click();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('konkurs: the word alone, then the rest; bostyrer in bold', () => {
    const { heading, section } = buildAnswer({
      tone: 'danger',
      headline: 'Konkurs siden 26. aug. 2026',
      supporting: 'Bostyrer: Adv. Kari Nordmann',
      stamp: { word: 'Konkurs', rest: 'siden 26. aug. 2026' },
      actions: [],
    });
    expect(heading.textContent).toBe('Konkurs siden 26. aug. 2026');
    expect(heading.querySelector('.stamp-pre')).toBeNull();
    expect(section.querySelector('.answer__support b')?.textContent).toBe('Adv. Kari Nordmann');
  });

  it('the error band is warn with «Prøv igjen», never an alert or a stamp', () => {
    const onRetry = vi.fn();
    const { section, heading } = buildErrorAnswer(
      { head: COPY.noAnswerHead, support: 'Registeret svarte ikke.', retry: true },
      { onRetry },
    );
    expect(section.className).toBe('answer answer--warn');
    expect(section.getAttribute('role')).toBeNull();
    expect(heading.textContent).toBe('Fikk ikke svar fra Brønnøysundregistrene');
    const retry = section.querySelector<HTMLButtonElement>('.answer__actions button')!;
    expect(retry.textContent).toBe('Prøv igjen');
    retry.click();
    expect(onRetry).toHaveBeenCalledOnce();
    const noRetry = buildErrorAnswer({ head: 'x', support: 'y', retry: false });
    expect(noRetry.section.querySelector('.answer__actions')).toBeNull();
  });

  it('renderAnswer replaces the container content; the skeleton is hidden from AT', () => {
    const div = document.createElement('div');
    div.append(document.createElement('p'));
    renderAnswer(div, { tone: 'ok', headline: 'x', actions: [] });
    expect(div.childElementCount).toBe(1);
    expect(div.firstElementChild?.classList.contains('answer--ok')).toBe(true);
    expect(buildAnswerLoading().getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ledger', () => {
  const row = (extra: Partial<LedgerRow>): LedgerRow => ({
    key: 'status',
    label: 'Status',
    tone: 'ok',
    value: 'Aktiv',
    actions: [],
    ...extra,
  });

  it('every row carries its tone as a glyph, data-tone and sr-only text', () => {
    const dl = buildLedger([
      row({ tone: 'ok' }),
      row({ key: 'kobling', label: 'Kobling', tone: 'warn', value: 'Gjettet fra navnet «bbc»' }),
      row({ tone: 'danger', value: 'Konkurs', dangerValue: true }),
      row({ key: 'alder', label: 'Alder', tone: 'neutral', value: '54 år', aux: '· stiftet 1972' }),
    ]);
    expect(dl.className).toBe('ledger');
    const rows = [...dl.querySelectorAll('.ledger-row')];
    expect(rows.map((r) => r.getAttribute('data-tone'))).toEqual(['ok', 'warn', 'danger', 'neutral']);
    expect(rows.map((r) => r.querySelector('dt use')?.getAttribute('href'))).toEqual([
      '#g-ok',
      '#g-warn',
      '#g-danger',
      '#g-dot',
    ]);
    expect(rows.map((r) => r.querySelector('dt .sr-only')?.textContent ?? null)).toEqual([
      ', ok',
      ', advarsel',
      ', alvorlig',
      null,
    ]);
    expect(rows[2]!.classList.contains('ledger-row--danger-value')).toBe(true);
    expect(rows[3]!.querySelector('dd')?.textContent).toBe('54 år · stiftet 1972');
    expect(rows[3]!.querySelector('.ledger-row__aux')?.textContent).toBe('· stiftet 1972');
  });

  it('an inline row puts the first action on the value line', () => {
    const onReject = vi.fn();
    const div = buildLedgerRow(
      row({ key: 'kobling', label: 'Kobling', value: 'dnb.no er registrert hjemmeside', inline: true, actions: [{ kind: 'reject' }] }),
      { onReject },
    );
    expect(div.classList.contains('ledger-row--inline')).toBe(true);
    const detail = div.querySelector('.ledger-row__detail')!;
    expect(detail.querySelector('.ledger-row__act')).toBeNull();
    const btn = detail.querySelector<HTMLButtonElement>('button.text-btn')!;
    expect(btn.textContent).toBe('Feil bedrift?');
    btn.click();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('detail, figures and every action kind', () => {
    const onForget = vi.fn();
    const div = buildLedgerRow(
      row({
        key: 'kobling',
        label: 'Kobling',
        tone: 'warn',
        value: 'Gjettet fra navnet «bbc»',
        detail: 'ingen hjemmeside registrert',
        actions: [{ kind: 'reject' }, { kind: 'forget' }, { kind: 'report' }, { kind: 'link', text: 'Kunngjøringer', href: 'https://w2.brreg.no/kunngjoring/' }],
      }),
      { onForget, reportHref: 'mailto:sebastian@nuez.no?subject=x' },
    );
    const acts = [...div.querySelectorAll('.ledger-row__act')];
    expect(acts.map((a) => a.textContent)).toEqual(['Feil bedrift?', 'Glem valget', 'Rapporter feil treff', 'Kunngjøringer ↗']);
    (acts[1]!.firstElementChild as HTMLButtonElement).click();
    expect(onForget).toHaveBeenCalledOnce();
    expect(acts[2]!.querySelector('a')?.getAttribute('href')).toBe('mailto:sebastian@nuez.no?subject=x');
    expect(acts[3]!.querySelector('a')?.target).toBe('_blank');

    const money = buildLedgerRow(
      row({
        key: 'regnskap',
        label: 'Regnskap',
        value: '2025 levert',
        figures: [
          [{ text: 'omsetning ', nowrap: true }, { text: '68,0 mrd USD', nowrap: true }],
          [{ text: 'resultat ', nowrap: true }, { text: '-8,8 mrd USD', nowrap: true, negative: true }],
        ],
      }),
    );
    expect(money.querySelector('.ledger-row__detail')?.textContent).toBe('omsetning 68,0 mrd USD · resultat -8,8 mrd USD');
    expect(money.querySelector('.num--neg')?.textContent).toBe('-8,8 mrd USD');
  });

  it('a report action without a mailto is left out, never a dead link', () => {
    const div = buildLedgerRow(row({ actions: [{ kind: 'report' }] }));
    expect(div.querySelector('.ledger-row__detail')).toBeNull();
  });

  it('spoof: the caption and the facts line', () => {
    const [cap, facts] = buildFacts([{ text: 'Aktiv', strong: true }, { text: ' · ' }, { text: '54 år', strong: true }]);
    expect(cap.className).toBe('ledger-cap');
    expect(cap.textContent).toBe('Om selskapet — sier ingenting om dette nettstedet');
    expect(facts.className).toBe('facts');
    expect(facts.querySelectorAll('b')).toHaveLength(2);
  });
});

describe('konsern + actions + footer', () => {
  it('the konsern row is a button with the strong part in <b>', () => {
    const onOpen = vi.fn();
    const btn = buildKonsernRow(
      { parts: [{ text: 'Morselskap i et konsern med ' }, { text: '55', strong: true }, { text: ' selskaper' }] },
      { onOpen },
    );
    expect(btn.className).toBe('konsern');
    expect(btn.querySelector('.konsern__text')?.textContent).toBe('Morselskap i et konsern med 55 selskaper');
    expect(btn.querySelector('.konsern__text b')?.textContent).toBe('55');
    expect(btn.querySelector('.konsern__chev use')?.getAttribute('href')).toBe('#i-chev');
    btn.click();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('«Kopier sammendrag» copies the summary, swaps its label and announces', async () => {
    vi.useFakeTimers();
    const handlers = { ...copyHandlers(), onOpenPanel: vi.fn((ev: MouseEvent) => ev.preventDefault()) };
    const actions = buildActions({ summary: 'DNB BANK ASA (org.nr …)', panelHref: 'moz-extension://x/details/details.html?orgnr=1' }, handlers);
    expect(actions.openPanel?.textContent).toBe('Åpne i sidepanel');
    expect(actions.openPanel?.getAttribute('href')).toBe('moz-extension://x/details/details.html?orgnr=1');
    actions.openPanel!.click();
    expect(handlers.onOpenPanel).toHaveBeenCalledOnce();

    expect(actions.copySummary.textContent).toBe('Kopier sammendrag');
    actions.copySummary.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(handlers.copy).toHaveBeenCalledWith('DNB BANK ASA (org.nr …)');
    expect(actions.copySummary.classList.contains('is-copied')).toBe(true);
    expect(actions.copySummary.textContent).toBe('Kopiert');
    expect(handlers.announce).toHaveBeenCalledWith('Sammendrag kopiert');
    await vi.advanceTimersByTimeAsync(COPY_FEEDBACK_MS);
    expect(actions.copySummary.textContent).toBe('Kopier sammendrag');
    expect(actions.copySummary.classList.contains('is-copied')).toBe(false);
  });

  it('without a panel href there is only the copy button', () => {
    const actions = buildActions({ summary: 'x' }, copyHandlers());
    expect(actions.openPanel).toBeUndefined();
    expect(actions.container.querySelectorAll('.btn')).toHaveLength(1);
  });

  it('the footer: freshness + Oppdater, the mailto, the NLOD line', () => {
    const foot = document.createElement('footer');
    const onRefresh = vi.fn();
    const now = Date.UTC(2026, 8, 24, 12, 0, 0);
    renderFooter(foot, { fetchedAt: now - 120_000, now, reportHref: 'mailto:sebastian@nuez.no' }, { onRefresh });
    const rows = [...foot.querySelectorAll('.foot__row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toBe('Hentet for 2 min siden · OppdaterRapporter feil treff');
    rows[0]!.querySelector('button')!.click();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(rows[0]!.querySelector('a')?.getAttribute('href')).toBe('mailto:sebastian@nuez.no');
    expect(rows[1]!.textContent).toBe('Data fra Brønnøysundregistrene (NLOD 2.0)');
    expect(rows[1]!.querySelector('a')?.getAttribute('href')).toBe(COPY.nlodUrl);
  });

  it('the footer without freshness keeps the attribution and shares its row with the mailto', () => {
    const foot = document.createElement('footer');
    renderFooter(foot, { reportHref: 'mailto:x' });
    const rows = [...foot.querySelectorAll('.foot__row')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelectorAll('a')).toHaveLength(2);
    renderFooter(foot, { loading: true });
    expect(foot.querySelector('.foot__row')?.textContent).toBe('Henter …');
  });
});

describe('skeleton', () => {
  it('has the loaded geometry with real labels and shimmering values, hidden from AT', () => {
    const frag = buildSkeleton('popup');
    const labels = [...frag.querySelectorAll('.ledger-row dt')].map((dt) => dt.textContent);
    expect(labels).toEqual(['Kobling', 'Status', 'Alder', 'Ansatte', 'Regnskap']);
    expect(frag.querySelector('.answer--loading')?.getAttribute('aria-hidden')).toBe('true');
    expect(frag.querySelector('.ledger')?.getAttribute('aria-hidden')).toBe('true');
    expect(frag.querySelector('.ident__leaders .sk')).not.toBeNull();
    expect(buildSkeleton('panel').querySelector('.ident__flags .sk')).not.toBeNull();
  });
});

describe('picker', () => {
  const candidates: Candidate[] = [
    { ...(enhetDnb as unknown as Candidate), evidence: 'hjemmeside' },
    { ...(enhetKonkurs as unknown as Candidate), evidence: 'navn' },
  ];
  function setup() {
    const main = document.createElement('main');
    document.body.appendChild(main);
    const handlers = { onPick: vi.fn(), onNone: vi.fn(), onSearchSelect: vi.fn(), announce: vi.fn() };
    const picker = renderPicker(main, { site: 'dnb.no', candidates, query: 'dnb' }, handlers);
    return { main, handlers, picker };
  }
  const press = (key: string, target: EventTarget = document.body) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
  };

  it('paints the head, the rows with kbd, evidence and status mark, «Ingen av disse», the field', () => {
    const { main, picker } = setup();
    expect(picker.heading.textContent).toBe('Mulige selskaper bak dnb.no');
    // A row has the site itself registered, so «Ingen har …» would be false.
    expect(main.querySelector('.pick-head p')?.textContent).toBe(COPY.pickSubStrong);
    const rows = [...main.querySelectorAll('button.pick')];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.getAttribute('aria-keyshortcuts'))).toEqual(['1', '2', '0']);
    expect(rows[0]!.querySelector('.pick__name')?.textContent).toBe('DNB BANK ASA');
    expect(rows[0]!.querySelector('.evidence')?.className).toBe('evidence evidence--strong');
    expect(rows[0]!.querySelector('.pick__right')?.textContent).toContain('ansatte');
    expect(rows[1]!.querySelector('.evidence')?.className).toBe('evidence evidence--weak');
    expect(rows[1]!.querySelector('.status-mark')?.textContent).toBe('Konkurs');
    expect(rows[2]!.textContent).toBe(`0${COPY.none}`);
    expect(picker.firstRow).toBe(rows[0]);
    expect(picker.input.value).toBe('dnb');
    expect(main.querySelector('label.field-label')?.textContent).toBe(COPY.searchYourself);
    expect(main.querySelector<HTMLLabelElement>('label.field-label')?.htmlFor).toBe(picker.input.id);
  });

  it('labels a page on the site «underside» (weak) and keeps «Ingen har …» true without an exact row', () => {
    const main = document.createElement('main');
    document.body.appendChild(main);
    renderPicker(
      main,
      {
        site: 'nrk.no',
        candidates: [
          { ...(enhetKonkurs as unknown as Candidate), evidence: 'navn' },
          { ...(enhetDnb as unknown as Candidate), evidence: 'side' },
        ],
        query: 'nrk',
      },
      { onPick: vi.fn(), onNone: vi.fn(), onSearchSelect: vi.fn(), announce: vi.fn() },
    );
    expect(main.querySelector('.pick-head p')?.textContent).toBe(COPY.pickSub('nrk.no'));
    const tags = [...main.querySelectorAll<HTMLElement>('.evidence')];
    expect(tags.map((t) => t.textContent)).toEqual([COPY.evidenceWeak, COPY.evidencePage]);
    expect(tags[1]!.className).toBe('evidence evidence--weak');
    expect(tags[1]!.title).toBe(COPY.evidencePageTitle('nrk.no'));
    main.remove();
  });

  it('digit keys pick a row and 0 is «Ingen av disse»; Escape and inputs are left alone', () => {
    const { handlers, picker } = setup();
    expect(press('2').defaultPrevented).toBe(true);
    expect(handlers.onPick).toHaveBeenCalledWith('915330193');
    expect(press('0').defaultPrevented).toBe(true);
    expect(handlers.onNone).toHaveBeenCalledOnce();
    expect(press('Escape').defaultPrevented).toBe(false);
    expect(press('9').defaultPrevented).toBe(false);
    handlers.onPick.mockClear();
    press('1', picker.input);
    expect(handlers.onPick).not.toHaveBeenCalled();
    const ctrl = new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ctrl);
    expect(handlers.onPick).not.toHaveBeenCalled();
  });

  it('the keys are scoped to the picker on screen', () => {
    const { main, handlers } = setup();
    main.replaceChildren();
    press('1');
    expect(handlers.onPick).not.toHaveBeenCalled();
  });

  it('clicking a row or «Ingen av disse» does the same', () => {
    const { main, handlers } = setup();
    const rows = main.querySelectorAll<HTMLButtonElement>('button.pick');
    rows[0]!.click();
    expect(handlers.onPick).toHaveBeenCalledWith('984851006');
    rows[2]!.click();
    expect(handlers.onNone).toHaveBeenCalledOnce();
  });
});

describe('search view + recents', () => {
  it('paints the head, text, field, hint and the recents with status marks', () => {
    const main = document.createElement('main');
    const onSelect = vi.fn();
    const view = renderSearchView(
      main,
      {
        head: COPY.emptyNoSite,
        text: COPY.emptyNoSiteText,
        hint: true,
        recents: [
          { orgnr: '984851006', navn: 'DNB BANK ASA', ts: 2 },
          { orgnr: '915330193', navn: '1VASK AS', ts: 1, status: 'Konkurs' },
        ],
      },
      { onSelect, announce: vi.fn() },
    );
    expect(view.heading.textContent).toBe('Ingen nettside å slå opp');
    expect(main.querySelector('.empty > p')?.textContent).toBe(COPY.emptyNoSiteText);
    expect(view.input.getAttribute('aria-label')).toBe(COPY.searchPlaceholder);
    expect(main.querySelector('.hint')?.textContent).toBe(COPY.searchHint);
    expect(view.results.section.hidden).toBe(true);
    expect(view.recents.section.hidden).toBe(false);
    const rows = [...view.recents.list.querySelectorAll<HTMLButtonElement>('button.recent')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('b')?.textContent).toBe('DNB BANK ASA');
    expect(rows[0]!.querySelector('.recent__on')?.textContent).toBe(`984${NBSP}851${NBSP}006`);
    expect(rows[1]!.querySelector('.status-mark')?.textContent).toBe('Konkurs');
    rows[1]!.click();
    expect(onSelect).toHaveBeenCalledWith('915330193');
    expect(view.back).toBeUndefined();
  });

  it('the back affordance, «Glem valget» and a banner between the block and the lists', () => {
    const main = document.createElement('main');
    const onBack = vi.fn();
    const onForget = vi.fn();
    const banner = document.createElement('section');
    banner.className = 'answer answer--warn';
    const view = renderSearchView(
      main,
      { head: 'x', recents: [], forgetSite: 'dnb.no', back: 'Tilbake til DNB BANK ASA', after: [banner] },
      { onSelect: vi.fn(), announce: vi.fn(), onBack, onForget },
    );
    expect(view.back?.textContent).toBe('Tilbake til DNB BANK ASA');
    view.back!.click();
    expect(onBack).toHaveBeenCalledOnce();
    const forget = main.querySelector<HTMLButtonElement>('.empty__undo button')!;
    expect(forget.textContent).toBe('Glem valget for dnb.no');
    forget.click();
    expect(onForget).toHaveBeenCalledOnce();
    expect([...main.children].map((c) => c.className)).toEqual(['back', 'empty', 'answer answer--warn', 'section', 'section']);
    expect(view.recents.section.hidden).toBe(true);
  });

  it('the recents section hides when empty; entry rows carry a sub line', () => {
    const section = buildListSection('Nylig sett');
    renderRecents(section, [], vi.fn());
    expect(section.section.hidden).toBe(true);
    const li = buildEntryRow({ name: 'X AS', orgnr: '923609016', sub: 'Utvinning av råolje' }, vi.fn());
    expect(li.querySelector('.recent__sub')?.textContent).toBe('Utvinning av råolje');
  });

  it('statusMarkFor reads a danger status off a search hit', () => {
    expect(statusMarkFor(enhetKonkurs as unknown as Candidate)).toBe('Konkurs');
    expect(statusMarkFor(enhetDnb as unknown as Candidate)).toBeUndefined();
  });
});

describe('tab order of a painted result', () => {
  it('runs mast → org.nr → brreg.no → row actions → konsern → actions', () => {
    const header = document.createElement('header');
    const main = document.createElement('main');
    document.body.append(header, main);
    renderMasthead(header, { kind: 'popup', host: 'www.dnb.no', search: true });
    const ident = document.createElement('div');
    renderIdentity(
      ident,
      { name: 'DNB', claim: false, orgnr: ORGNR, brregUrl: 'https://x', leaders: [], flags: '' },
      copyHandlers(),
    );
    main.append(ident);
    main.append(buildAnswer({ tone: 'ok', headline: 'x', actions: [] }).section);
    main.append(
      buildLedger([{ key: 'kobling', label: 'Kobling', tone: 'ok', value: 'v', inline: true, actions: [{ kind: 'reject' }] }]),
    );
    main.append(buildKonsernRow({ parts: [{ text: 'k' }] }));
    main.append(buildActions({ summary: 's', panelHref: '#p' }, copyHandlers()).container);
    const focusable = [...document.querySelectorAll<HTMLElement>('button, a[href], input')].map(
      (el) => el.getAttribute('aria-label') ?? el.textContent?.trim(),
    );
    expect(focusable).toEqual([
      'Søk etter selskap',
      `Kopier org.nr ${ORGNR.spaced}`,
      'brreg.no ↗',
      'Feil bedrift?',
      'k',
      'Åpne i sidepanel',
      'Kopier sammendrag',
    ]);
    // Nothing in the result carries a positive tabindex: the DOM order is the tab order.
    expect(document.querySelector('[tabindex]:not([tabindex="-1"])')).toBeNull();
  });
});
