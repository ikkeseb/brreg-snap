// @vitest-environment happy-dom
//
// The panel painter (src/details/painter.ts) on details.html's roots
// with a fake controller: each state's markup contract, every tab's
// content, the tablist, the compact head, the search view opened from
// the masthead (keep + restore, no repaint), the consent band, and the
// a11y contract — one live region, role=alert only on the stamp,
// sr-only tone text.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompanyData } from '../src/lib/company-load.js';
import { deriveKonsern } from '../src/lib/konsern.js';
import { createSwitchAutoSyncUi } from '../src/details/auto-sync-switch.js';
import { createPanelPainter, type PainterRoots } from '../src/details/painter.js';
import type { PanelIntents, ResultPaint } from '../src/details/view.js';
import { COPY } from '../src/lib/view/copy.js';
import { appendName } from '../src/lib/view/components/dom.js';
import { liveRegionOf } from '../src/lib/view/components/live.js';
import { renderMasthead } from '../src/lib/view/components/masthead.js';
import type { Enhet, KonsernNode } from '../src/types/brreg.js';
import { fakeBrowser } from './helpers/fake-browser.js';
import enhetEquinor from './fixtures/brreg/enhet-923609016-equinor.json';
import enhetKonkurs from './fixtures/brreg/enhet-915330193-konkurs.json';
import enhetPaategning from './fixtures/brreg/enhet-935864879-paategning.json';
import konsernEquinor from './fixtures/brreg/konsernstruktur-923609016-equinor.json';
import regnskapEquinor from './fixtures/brreg/regnskap-923609016-usd.json';
import rollerEquinor from './fixtures/brreg/roller-923609016-equinor.json';
import rollerKonkurs from './fixtures/brreg/roller-915330193-konkurs.json';

const NOW = new Date(2026, 8, 30, 12);
const NBSP = ' ';

function equinor(): CompanyData {
  const tree = konsernEquinor as KonsernNode;
  return {
    enhet: enhetEquinor,
    roller: rollerEquinor,
    regnskap: { items: regnskapEquinor },
    underenheter: {
      items: [
        {
          organisasjonsnummer: '973118402',
          navn: 'EQUINOR ASA AVD FORUS',
          beliggenhetsadresse: { adresse: ['Forusbeen 50'], postnummer: '4035', poststed: 'STAVANGER' },
          antallAnsatte: 1840,
        },
        { organisasjonsnummer: '975002318', navn: 'EQUINOR ASA AVD BERGEN', slettedato: '2025-02-03' },
      ],
      total: 133,
    },
    endringer: [],
    aarsregnskapYears: ['2025', '2024', '2023', '2022', '2021', '2020', '2019'],
    konsern: deriveKonsern(tree, '923609016'),
    konsernTree: tree,
    fetchedAt: NOW.getTime() - 120_000,
  };
}

function konkurs(): CompanyData {
  return {
    enhet: enhetKonkurs,
    roller: rollerKonkurs,
    regnskap: undefined,
    underenheter: undefined,
    endringer: undefined,
    aarsregnskapYears: undefined,
    konsern: null,
    fetchedAt: NOW.getTime(),
  };
}

function mount() {
  document.body.className = 'app app--panel';
  document.body.dataset.answer = 'loading';
  const live = document.createElement('p');
  live.id = 'live';
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  const mast = document.createElement('header');
  mast.className = 'mast';
  const underMast = document.createElement('div');
  const stick = document.createElement('div');
  stick.className = 'stick';
  stick.hidden = true;
  const back = document.createElement('button');
  back.className = 'back';
  back.hidden = true;
  const main = document.createElement('main');
  main.id = 'app';
  main.dataset.state = 'loading';
  const foot = document.createElement('footer');
  foot.className = 'foot';
  document.body.replaceChildren(live, mast, underMast, stick, back, main, foot);
  const masthead = renderMasthead(mast, { kind: 'panel', autoSync: { on: false } });
  const roots: PainterRoots = {
    body: document.body,
    search: masthead.input!,
    stick,
    back,
    main,
    foot,
    live: liveRegionOf(live),
  };
  return { roots, underMast, toggle: masthead.toggle!, live };
}

function fakeIntents(): PanelIntents {
  return {
    drill: vi.fn(),
    back: vi.fn(),
    reject: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    retry: vi.fn(),
    refresh: vi.fn(),
    pick: vi.fn(),
    none: vi.fn(),
    manual: vi.fn(),
    recent: vi.fn(),
    search: vi.fn(),
    selectTab: vi.fn(),
  };
}

function setup(opts: { initialTab?: string; recents?: Array<{ orgnr: string; navn: string; ts: number }> } = {}) {
  const mounted = mount();
  const intents = fakeIntents();
  const deps = {
    copy: vi.fn(async () => true),
    getRecent: vi.fn(async () => opts.recents ?? []),
    getRememberedChoice: vi.fn(async () => undefined),
    setPickerChoice: vi.fn(async () => {}),
    env: { version: '1.4.0', browser: 'Chrome' },
    now: () => NOW,
  };
  const painter = createPanelPainter(mounted.roots, intents, {
    ...(opts.initialTab ? { initialTab: opts.initialTab } : {}),
    deps,
  });
  return { ...mounted, intents, deps, painter };
}

function resultPaint(company: CompanyData, extra: Partial<ResultPaint> = {}): ResultPaint {
  return {
    company,
    method: 'host-auto',
    host: 'www.equinor.com',
    fetchedAt: company.fetchedAt,
    isStale: () => false,
    focus: 'none',
    ...extra,
  };
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const qa = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const app = () => document.getElementById('app')!;
const tabs = () => qa('[role="tab"]');
const selectedTab = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.id;
const shownPanel = () => qa('[role="tabpanel"]').find((p) => !p.hidden)?.id;
const byText = (text: string): HTMLElement | undefined =>
  qa('button, a').find((el) => el.textContent?.trim() === text);

beforeEach(() => {
  fakeBrowser({ engine: 'chrome' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('result: the dossier', () => {
  it('paints identity, answer, ledger, konsern row, tabs with counts and the Oversikt sections', () => {
    const { painter } = setup();
    painter.result(resultPaint(equinor()));
    expect(app().dataset.state).toBe('result');
    expect(document.body.dataset.answer).toBe('ok');
    expect(app().hasAttribute('inert')).toBe(false);
    expect(app().classList.contains('reveal')).toBe(true);

    expect(q('h1.ident__name')?.textContent).toBe('EQUINOR ASA');
    expect(q('.ident__row .ident__flags')?.textContent).toBe('MVA-registrert · Foretaksregisteret');
    expect(q('.ident__row .text-btn')?.textContent).toBe('Kopier sammendrag');
    expect(q('.answer--ok h2')?.textContent).toBe('Ingen varsler i registeret');
    expect(qa('.ledger-row').map((r) => r.dataset.key)).toEqual(['kobling', 'status', 'alder', 'ansatte', 'regnskap']);
    expect(q('.konsern__text')?.textContent).toBe('Morselskap i et konsern med 55 selskaper');

    const tablist = q('[role="tablist"]')!;
    expect(tablist.getAttribute('aria-label')).toBe('Detaljer');
    expect(tabs().map((t) => t.id)).toEqual(['tab-oversikt', 'tab-personer', 'tab-okonomi', 'tab-enheter']);
    expect(q('#tab-personer .tab__count')?.textContent).toBe('6');
    expect(q('#tab-enheter .tab__count')?.textContent).toBe('133');
    expect(q('#tab-okonomi .tab__count')).toBeNull();
    expect(selectedTab()).toBe('tab-oversikt');
    expect(shownPanel()).toBe('panel-oversikt');
    expect(q('#tab-oversikt')?.getAttribute('aria-controls')).toBe('panel-oversikt');
    expect(q('#panel-oversikt')?.getAttribute('aria-labelledby')).toBe('tab-oversikt');

    const heads = [...document.querySelectorAll('#panel-oversikt .section__head')].map((h) => h.textContent);
    expect(heads).toEqual(['Registrering', 'Ledelse', 'Kontakt']);
    const labels = [...document.querySelectorAll('#panel-oversikt .section:first-child dt')].map((d) => d.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Organisasjonsform', 'Stiftet', 'Registrert', 'Næring', 'Formål', 'Tidligere navn']));
    // The revisor is an entity: a drill-in button inside the value.
    expect(q('#panel-oversikt button.ent')?.textContent).toBe('ERNST & YOUNG AS');
  });

  it('the compact head carries seal, name and org.nr, and is hidden until scrolled', () => {
    const { painter, roots } = setup();
    painter.result(resultPaint(equinor()));
    expect(roots.stick.hidden).toBe(true);
    expect(roots.stick.querySelector('.answer__seal')?.getAttribute('data-tone')).toBe('ok');
    expect(roots.stick.querySelector('.stick__name')?.textContent).toBe('EQUINOR ASA');
    expect(roots.stick.querySelector('.stick__num')?.textContent).toBe(`923${NBSP}609${NBSP}016`);
  });

  it('a11y: one live region, role=alert only on the stamp, sr-only tone text per row', () => {
    const { painter } = setup();
    painter.result(resultPaint(equinor()));
    expect(qa('[aria-live]')).toHaveLength(1);
    expect(q('[role="alert"]')).toBeNull();
    expect(q('.ledger-row[data-key="status"] dt .sr-only')?.textContent).toBe(', ok');

    painter.result(resultPaint(konkurs(), { host: undefined, method: 'manual' }));
    expect(document.body.dataset.answer).toBe('danger');
    expect(qa('[role="alert"]')).toHaveLength(1);
    expect(q('[role="alert"] .stamp-word')?.textContent).toBe('Konkurs');
    expect(q('.ledger-row[data-key="status"] dt .sr-only')?.textContent).toBe(', alvorlig');
    expect(qa('[aria-live]')).toHaveLength(1);
  });

  it('Personer: groups with counts, «Avregistrert» struck, entities drill in', () => {
    const { painter, intents } = setup({ initialTab: 'personer' });
    painter.result(resultPaint(equinor()));
    expect(selectedTab()).toBe('tab-personer');
    expect(shownPanel()).toBe('panel-personer');
    const heads = [...document.querySelectorAll('#panel-personer .section__head')].map((h) => h.firstChild?.textContent);
    expect(heads).toEqual(expect.arrayContaining(['Daglig leder', 'Styre', 'Revisor']));
    const gone = q('#panel-personer .person--gone')!;
    expect(gone.querySelector('.person__role')?.textContent).toBe('Avregistrert');
    const entity = q<HTMLButtonElement>('#panel-personer button.entity-row')!;
    expect(entity.querySelector('b')?.textContent).toBe('ERNST & YOUNG AS');
    expect(entity.querySelector('small')?.textContent).toMatch(/^Org\.nr .* · åpne$/);
    entity.click();
    expect(intents.drill).toHaveBeenCalledWith('976389387');
  });

  it('Økonomi: figures with currency, the equity bar via --share, the honest note, PDF years, kunngjøringer', () => {
    const { painter } = setup({ initialTab: 'okonomi' });
    painter.result(resultPaint(equinor()));
    expect(shownPanel()).toBe('panel-okonomi');
    expect(q('#panel-okonomi .fig-head h2')?.textContent).toBe('Årsregnskap 2025');
    expect(q('#panel-okonomi .fig-head .cap')?.textContent).toBe('Beløp i USD');
    expect(q('#panel-okonomi .fig-status')?.textContent).toBe('Levert til Regnskapsregisteret');
    const rows = [...document.querySelectorAll('#panel-okonomi .fig-row dt')].map((d) => d.textContent);
    expect(rows).toEqual(expect.arrayContaining(['Driftsinntekter', 'Årsresultat', 'Sum eiendeler', 'Egenkapitalandel']));
    expect(q('#panel-okonomi .fig-row--total dd')?.querySelector('.fig-row__unit')?.textContent).toBe('mrd');
    const fill = q('#panel-okonomi .equity__fill')!;
    expect(fill.getAttribute('style')).toMatch(/--share:\s*\d+%/);
    expect(q('#panel-okonomi .honest')?.textContent).toBe(
      'Registeret deler bare siste års tall som åpne data. Eldre år finnes som PDF.',
    );
    const years = qa('#panel-okonomi .years a');
    expect(years.map((a) => a.textContent)).toEqual(['2025', '2024', '2023', '2022', '2021', '2020', '2019']);
    expect(years[0]?.getAttribute('title')).toBe('PDF, lastes ned — kan ta litt tid');
    expect(years.filter((a) => !a.hidden)).toHaveLength(5);
    const more = q<HTMLButtonElement>('#panel-okonomi .years__more')!;
    expect(more.textContent).toBe('eldre…');
    more.click();
    expect(years.filter((a) => !a.hidden)).toHaveLength(7);
    expect(q('#panel-okonomi .years__more')).toBeNull();
    const ext = q<HTMLAnchorElement>('#panel-okonomi .ext-row a')!;
    expect(ext.textContent).toBe('Kunngjøringer ↗');
    expect(ext.href).toContain('w2.brreg.no/kunngjoring');
  });

  it('Enheter: the Konsern section (path, children capped at 20, «Vis alle»), then the units', () => {
    const { painter, intents } = setup({ initialTab: 'enheter' });
    painter.result(resultPaint(equinor()));
    expect(shownPanel()).toBe('panel-enheter');
    const sections = qa('#panel-enheter > .section');
    expect(sections.map((s) => s.querySelector('.section__head')?.firstChild?.textContent)).toEqual(['Konsern', 'Underenheter']);

    const konsern = sections[0]!;
    expect(konsern.querySelector('.entity-row--self b')?.textContent).toBe('EQUINOR ASA');
    expect(konsern.querySelector('.entity-row--self small')?.textContent).toBe('Dette selskapet');
    const children = [...konsern.querySelectorAll('ul:not(.konsern-path) li')];
    expect(children).toHaveLength(34);
    expect(children.filter((li) => !(li as HTMLElement).hidden)).toHaveLength(20);
    const showAll = byText('Vis alle 34')!;
    showAll.click();
    expect(children.filter((li) => !(li as HTMLElement).hidden)).toHaveLength(34);
    (children[0]!.querySelector('button') as HTMLButtonElement).click();
    expect(intents.drill).toHaveBeenCalledWith(expect.stringMatching(/^\d{9}$/));

    const units = sections[1]!;
    expect(units.querySelector('.section__head .tab__count')?.textContent).toBe('133');
    expect(units.querySelector('.units-count')?.textContent).toBe('Viser 2 av 133 · Se alle på brreg.no ↗');
    const first = units.querySelector('.unit')!;
    // Amendment c: the parent's name is a quieter prefix; the text stays whole.
    expect(first.querySelector('.unit__name')?.textContent).toBe('EQUINOR ASA AVD FORUS');
    expect(first.querySelector('.unit__name .name-prefix')?.textContent).toBe('EQUINOR ASA ');
    expect(first.querySelector('.unit__meta')?.textContent).toBe(`Forusbeen 50, 4035 STAVANGER · 1${NBSP}840 ansatte`);
    expect(first.querySelector('button.orgnr--sm')?.textContent).toBe(`973${NBSP}118${NBSP}402`);
    expect(first.querySelector('.orgnr__label')).toBeNull();
    const gone = units.querySelector('.unit--gone')!;
    expect(gone.querySelector('.unit__meta')?.textContent).toBe('Slettet 3. feb. 2025');
  });

  it('merknader and «Endret nylig» come after the ledger, before the tabs', () => {
    const { painter } = setup();
    const company: CompanyData = {
      ...konkurs(),
      enhet: enhetPaategning,
      roller: undefined,
      endringer: [],
    };
    painter.result(resultPaint(company));
    const order = [...app().children].map((c) => c.className.split(' ')[0]);
    const ledger = order.indexOf('ledger');
    const notes = order.indexOf('notes');
    const tabsAt = order.indexOf('tabs');
    expect(ledger).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(ledger);
    expect(tabsAt).toBeGreaterThan(notes);
    expect(q('.notes .quote p')?.textContent).toMatch(/^Foretaksregisteret har grunn til å anta/);
    expect(q('.notes .quote__date time')?.getAttribute('datetime')).toBe('2026-09-01');
  });

  it('a tab click persists the key; a restored ?tab= only reflects it; the key survives a new company', () => {
    const { painter, intents } = setup();
    painter.result(resultPaint(equinor()));
    q<HTMLButtonElement>('#tab-okonomi')!.click();
    expect(intents.selectTab).toHaveBeenCalledWith('okonomi');
    expect(shownPanel()).toBe('panel-okonomi');
    painter.selectTab('enheter');
    expect(shownPanel()).toBe('panel-enheter');
    expect(intents.selectTab).toHaveBeenCalledTimes(1);
    painter.result(resultPaint(konkurs()));
    expect(selectedTab()).toBe('tab-enheter');
  });

  it('the konsern row opens the Enheter tab', () => {
    const { painter, intents } = setup();
    painter.result(resultPaint(equinor()));
    q<HTMLButtonElement>('button.konsern')!.click();
    expect(shownPanel()).toBe('panel-enheter');
    expect(intents.selectTab).toHaveBeenCalledWith('enheter');
  });

  it('a drill-in labels the back bar with the company it came from; focus lands on the heading', () => {
    const { painter, intents, roots } = setup({ initialTab: 'personer' });
    painter.result(resultPaint(equinor()));
    q<HTMLButtonElement>('#panel-personer button.entity-row')!.click();
    expect(intents.drill).toHaveBeenCalled();
    painter.result(resultPaint(konkurs(), { method: 'drill-in', host: undefined, focus: 'heading' }));
    painter.setBack(true);
    expect(roots.back.hidden).toBe(false);
    expect(roots.back.textContent).toBe('Tilbake til EQUINOR ASA');
    expect(document.activeElement).toBe(q('h1.ident__name'));
    roots.back.click();
    expect(intents.back).toHaveBeenCalled();
    // A Back restore has no known origin: the plain label.
    painter.result(resultPaint(equinor(), { method: 'drill-in', focus: 'heading' }));
    expect(roots.back.textContent).toBe('Tilbake');
  });

  it('provenance swaps what is above the tabs and keeps the tab panels', () => {
    const { painter } = setup();
    painter.result(resultPaint(equinor()));
    const panel = q('#panel-oversikt');
    expect(byText('Feil bedrift?')).toBeDefined();
    painter.provenance({ method: 'manual', host: undefined });
    expect(byText('Feil bedrift?')).toBeUndefined();
    expect(q('.ledger-row[data-key="kobling"]')).toBeNull();
    expect(q('#panel-oversikt')).toBe(panel);
    expect(qa('h1')).toHaveLength(1);
  });

  it('«Feil bedrift?» and «Oppdater» reach the controller; the footer carries the freshness', () => {
    const { painter, intents } = setup();
    painter.result(resultPaint(equinor()));
    byText('Feil bedrift?')!.click();
    expect(intents.reject).toHaveBeenCalledOnce();
    expect(q('.foot')?.textContent).toContain('Hentet for 2 min siden');
    byText('Oppdater')!.click();
    expect(intents.refresh).toHaveBeenCalledOnce();
    painter.result(resultPaint(equinor(), { focus: 'refresh' }));
    expect(document.activeElement).toBe(byText('Oppdater'));
  });
});

describe('loading, error, empty, picker', () => {
  it('loading: the skeleton, main inert and busy, the live region says «Henter»', async () => {
    vi.useFakeTimers();
    const { painter, live } = setup();
    painter.loading('923609016');
    expect(app().dataset.state).toBe('loading');
    expect(app().hasAttribute('inert')).toBe(true);
    expect(app().getAttribute('aria-busy')).toBe('true');
    expect(q('.answer--loading')).not.toBeNull();
    expect(qa('.ledger-row dt').map((d) => d.textContent)).toEqual(['Kobling', 'Status', 'Alder', 'Ansatte', 'Regnskap']);
    expect(q('[role="tablist"]')).toBeNull();
    expect(q('.foot')?.textContent).toContain('Henter …');
    await vi.advanceTimersByTimeAsync(0);
    expect(live.textContent).toBe(`Henter 923${NBSP}609${NBSP}016 fra Brønnøysundregistrene …`);
  });

  it('error: the org.nr context, a warn band (never a stamp) with «Prøv igjen» only when retry is possible', () => {
    const { painter, intents } = setup();
    painter.loading('984851006');
    painter.error(new TypeError('Failed to fetch'), { retry: true, focus: true });
    expect(app().dataset.state).toBe('error');
    expect(document.body.dataset.answer).toBe('warn');
    expect(q('[role="alert"]')).toBeNull();
    expect(q('.context')?.textContent).toBe(`Oppslag på org.nr 984${NBSP}851${NBSP}006`);
    expect(q('.answer--warn h2')?.textContent).toBe('Fikk ikke svar fra Brønnøysundregistrene');
    expect(document.activeElement).toBe(q('.answer--warn h2'));
    byText('Prøv igjen')!.click();
    expect(intents.retry).toHaveBeenCalledOnce();
    painter.error(new Error('No entity found for orgnr 984851006.'), { retry: false, focus: false });
    expect(byText('Prøv igjen')).toBeUndefined();
  });

  it('empty: no site, a site without a match, and a degraded check with its way out', async () => {
    const { painter, intents, roots } = setup({ recents: [{ orgnr: '984851006', navn: 'DNB BANK ASA', ts: 1 }] });
    painter.empty({ degraded: false, focus: true });
    expect(app().dataset.state).toBe('empty');
    expect(q('.empty h1')?.textContent).toBe('Ingen nettside å slå opp');
    expect(q('.empty p')?.textContent).toBe(COPY.emptyPanelText);
    expect(document.activeElement).toBe(roots.search);
    await vi.waitFor(() => expect(q('button.recent')).not.toBeNull());
    q<HTMLButtonElement>('button.recent')!.click();
    expect(intents.recent).toHaveBeenCalledWith('984851006');

    painter.empty({ host: 'www.example.com', degraded: false, focus: false });
    expect(q('.empty h1')?.textContent).toBe('Fant ikke selskapet bak example.com');
    expect(q('.answer--warn')).toBeNull();

    painter.empty({ host: 'www.example.com', degraded: true, focus: false });
    expect(document.body.dataset.answer).toBe('warn');
    expect(q('.empty h1')?.textContent).toBe('Fikk ikke sjekket example.com');
    expect(q('.answer--warn h2')?.textContent).toBe('Fikk ikke svar fra Brønnøysundregistrene');
    byText('Prøv igjen')!.click();
    expect(intents.retry).toHaveBeenCalledOnce();
  });

  it('empty for a site with a stored «Ingen av disse» says so and offers «Glem valget»', async () => {
    const { painter, intents, deps } = setup();
    deps.getRememberedChoice.mockResolvedValue({ kind: 'none' } as never);
    painter.empty({ host: 'www.nrk.no', degraded: false, focus: false });
    await vi.waitFor(() => expect(byText('Glem valget for nrk.no')).toBeDefined());
    expect(q('.empty h1')?.textContent).toBe('Du valgte «Ingen av disse» for nrk.no');
    byText('Glem valget for nrk.no')!.click();
    expect(intents.forget).toHaveBeenCalledOnce();
  });

  it('picker: the choice is persisted before the controller hears of it', async () => {
    const { painter, intents, deps } = setup();
    const candidates = [{ ...(enhetEquinor as Enhet), evidence: 'navn' as const }];
    painter.picker('www.nrk.no', candidates, { focus: true });
    expect(app().dataset.state).toBe('picker');
    expect(document.body.dataset.answer).toBe('pick');
    expect(q('.pick-head h1')?.textContent).toBe('Mulige selskaper bak nrk.no');
    const first = q<HTMLButtonElement>('button.pick')!;
    expect(document.activeElement).toBe(first);
    first.click();
    expect(intents.pick).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(intents.pick).toHaveBeenCalledWith('www.nrk.no', '923609016'));
    expect(deps.setPickerChoice).toHaveBeenCalledWith('www.nrk.no', '923609016');
    q<HTMLButtonElement>('button.pick--none')!.click();
    await vi.waitFor(() => expect(intents.none).toHaveBeenCalledWith('www.nrk.no'));
    expect(deps.setPickerChoice).toHaveBeenLastCalledWith('www.nrk.no', null);
  });
});

describe('the masthead search view', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ _embedded: { enheter: [enhetEquinor] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  it('typing swaps main for results with a back bar; Escape puts the previous DOM back untouched', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { painter, roots, intents } = setup({ recents: [{ orgnr: '984851006', navn: 'DNB BANK ASA', ts: 1 }] });
    painter.result(resultPaint(equinor()));
    q<HTMLButtonElement>('#tab-personer')!.click();
    const panel = q('#panel-personer');
    painter.setBack(false);

    roots.search.value = 'equinor';
    roots.search.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(250);
    expect(app().dataset.state).toBe('search');
    expect(q('h1')).toBeNull();
    expect(q('.search-view button.back')?.textContent).toBe('Tilbake til EQUINOR ASA');
    await vi.waitFor(() => expect(q('.results button.recent')).not.toBeNull());
    expect(q('.results button.recent b')?.textContent).toBe('EQUINOR ASA');

    // An empty field shows the recents instead of the results.
    roots.search.value = '';
    roots.search.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(q('.search-view .section:not([hidden]) .section__head')?.textContent).toBe('Nylig sett'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(app().dataset.state).toBe('result');
    expect(document.body.dataset.answer).toBe('ok');
    expect(q('#panel-personer')).toBe(panel);
    expect(shownPanel()).toBe('panel-personer');
    expect(roots.search.value).toBe('');
    expect(document.activeElement).toBe(roots.search);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(intents.manual).not.toHaveBeenCalled();
  });

  it('choosing a hit is a manual pick; a paint from the controller discards the search', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { painter, roots, intents } = setup();
    painter.result(resultPaint(equinor()));
    roots.search.value = 'equinor';
    roots.search.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(q('.results button.recent')).not.toBeNull());
    q<HTMLButtonElement>('.results button.recent')!.click();
    expect(intents.manual).toHaveBeenCalledWith('923609016');
    painter.loading('923609016');
    expect(app().dataset.state).toBe('loading');
    expect(roots.search.value).toBe('');
  });

  it('a search intent prefills the field and runs it over the empty state', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { painter, roots } = setup();
    painter.empty({ degraded: false, query: 'equinor', focus: true });
    expect(roots.search.value).toBe('equinor');
    expect(app().dataset.state).toBe('search');
    expect(q('.search-view button.back')?.textContent).toBe('Tilbake');
    await vi.waitFor(() => expect(q('.results button.recent')).not.toBeNull());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(app().dataset.state).toBe('empty');
    expect(q('.empty h1')?.textContent).toBe('Ingen nettside å slå opp');
  });
});

describe('the auto-sync switch and consent band', () => {
  it('flips aria-checked like a checkbox, shows the exact disclosure, and «Slå på» fires synchronously', () => {
    const { toggle, underMast, roots } = setup();
    const ui = createSwitchAutoSyncUi(toggle, underMast, roots.live);
    const change = vi.fn();
    const accept = vi.fn();
    const cancel = vi.fn();
    ui.onChange(change);
    ui.onConsentAccept(accept);
    ui.onConsentCancel(cancel);
    expect(toggle.getAttribute('role')).toBe('switch');
    toggle.click();
    expect(ui.checked).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(change).toHaveBeenCalledOnce();

    const band = underMast.querySelector<HTMLElement>('.consent')!;
    expect(band.hidden).toBe(true);
    ui.showConsent(true);
    expect(band.hidden).toBe(false);
    expect(band.getAttribute('role')).toBe('group');
    expect(band.querySelector('.consent__text')?.textContent).toBe(
      'Auto-oppdater slår opp siden du ser på hver gang du bytter fane eller åpner en ny side, ' +
        'så lenge et brreg-snap-panel er åpent: domenet sendes til Brønnøysundregistrene (data.brreg.no). ' +
        'Ingenting sendes til utvikleren. Nettleseren spør deretter om tilgang til fanene.',
    );
    const on = band.querySelector<HTMLButtonElement>('.btn--primary')!;
    expect(on.textContent).toBe('Slå på');
    expect(document.activeElement).toBe(on);
    on.click();
    expect(accept).toHaveBeenCalledOnce();
    band.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancel).toHaveBeenCalledOnce();
    band.querySelector<HTMLButtonElement>('.text-btn')!.click();
    expect(cancel).toHaveBeenCalledTimes(2);

    ui.checked = false;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    ui.disabled = true;
    toggle.click();
    expect(change).toHaveBeenCalledOnce();
    ui.showStatus('Tilgang avvist');
    expect(underMast.querySelector('.consent__status')?.textContent).toBe('Tilgang avvist');
    ui.showStatus(null);
    expect(underMast.querySelector<HTMLElement>('.consent__status')?.hidden).toBe(true);
    expect(qa('[aria-live]')).toHaveLength(1);
  });
});

describe('appendName (amendment c)', () => {
  it('mutes the parent prefix only when the name continues after it', () => {
    const b = document.createElement('b');
    appendName(b, 'NORDVIK ENERGI ASA AVD FORUS', 'NORDVIK ENERGI ASA');
    expect(b.textContent).toBe('NORDVIK ENERGI ASA AVD FORUS');
    expect(b.querySelector('.name-prefix')?.textContent).toBe('NORDVIK ENERGI ASA ');
    const same = document.createElement('b');
    appendName(same, 'NORDVIK ENERGI ASA', 'NORDVIK ENERGI ASA');
    expect(same.querySelector('.name-prefix')).toBeNull();
    const other = document.createElement('b');
    appendName(other, 'NORDVIK ENERGISERVICE AS', 'NORDVIK ENERGI');
    expect(other.querySelector('.name-prefix')).toBeNull();
  });
});
