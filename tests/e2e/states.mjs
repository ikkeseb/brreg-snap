// The smoke's state list, shared by the specs and the fixture recorder
// (record.mjs visits the same URLs, so every request a state makes has
// a recorded fixture). A redesign adds states here; each entry needs
// only a stable hook: the `data-state` value main#app must reach.

/**
 * @typedef {object} SmokeState
 * @property {string} name         screenshot/test name
 * @property {'panel' | 'popup'} surface
 * @property {string} path         harness URL (served by serve.mjs)
 * @property {'result' | 'picker' | 'empty' | 'error' | 'search'} state
 * @property {boolean} [offline]   abort every brreg request
 * @property {Array<{ type: 'click' | 'fill', selector: string, text?: string }>} [actions]
 *   user actions after the page settled on `before` (drill-in, typing)
 * @property {'result' | 'picker' | 'empty' | 'error'} [before]
 *   the state to wait for before the actions run
 */

/** @type {SmokeState[]} */
export const STATES = [
  // Bank: regnskap answers 500 (not in the open API).
  { name: 'dnb-bank', surface: 'panel', path: '/details/details.html?orgnr=984851006', state: 'result' },
  // Accounts in USD.
  { name: 'equinor-usd', surface: 'panel', path: '/details/details.html?orgnr=923609016', state: 'result' },
  { name: 'konkurs', surface: 'panel', path: '/details/details.html?orgnr=915330193', state: 'result' },
  { name: 'slettet', surface: 'panel', path: '/details/details.html?orgnr=989566733', state: 'result' },
  // An underenhet orgnr falls back to its parent (DNB).
  { name: 'underenhet', surface: 'panel', path: '/details/details.html?orgnr=973160834', state: 'result' },
  // A registry annotation (påtegning): merknad quoted after the ledger.
  { name: 'paategning', surface: 'panel', path: '/details/details.html?orgnr=935864879', state: 'result' },
  // A recent name change: «Endret nylig» + «Tidligere navn».
  { name: 'nytt-navn', surface: 'panel', path: '/details/details.html?orgnr=914375916', state: 'result' },
  // The other tabs, deep-linked (the popup's konsern row opens Enheter).
  { name: 'equinor-okonomi', surface: 'panel', path: '/details/details.html?orgnr=923609016&tab=okonomi', state: 'result' },
  { name: 'equinor-enheter', surface: 'panel', path: '/details/details.html?orgnr=923609016&tab=enheter', state: 'result' },
  // A drill-in from Personer (the revisor) with the back bar.
  {
    name: 'drill-in',
    surface: 'panel',
    path: '/details/details.html?orgnr=923609016&tab=personer',
    before: 'result',
    actions: [{ type: 'click', selector: '#panel-personer button.entity-row' }],
    state: 'result',
  },
  // The masthead field: the search view over a result.
  {
    name: 'search-view',
    surface: 'panel',
    path: '/details/details.html?orgnr=923609016',
    before: 'result',
    actions: [{ type: 'fill', selector: '.mast input[type=search]', text: 'kiwi' }],
    state: 'search',
  },
  { name: 'nomatch-recents', surface: 'panel', path: '/details/details.html?nomatch=example.com&seedrecents=1', state: 'empty' },
  { name: 'offline', surface: 'panel', path: '/details/details.html?orgnr=984851006', state: 'error', offline: true },
  { name: 'popup-dnb', surface: 'popup', path: '/popup/popup.html?taburl=https://www.dnb.no/', state: 'result' },
  // nrk.no's hjemmeside search yields several candidates.
  { name: 'popup-picker', surface: 'popup', path: '/popup/popup.html?taburl=https://www.nrk.no/', state: 'picker' },
  // A shop whose title carries Equinor's orgnr: the danger stamp
  // «Nettstedet er IKKE KOBLET til selskapet».
  {
    name: 'popup-spoof',
    surface: 'popup',
    path: '/popup/popup.html?taburl=https://trygg-handel-billig.shop/&tabtitle=Trygg%20Handel%20%7C%20Org.nr%20923%20609%20016',
    state: 'result',
  },
  // A konkurs company, its orgnr in the page URL: the KONKURS stamp.
  { name: 'popup-konkurs', surface: 'popup', path: '/popup/popup.html?taburl=https://example.no/?orgnr=915330193', state: 'result' },
  // No address to look up: search + recents.
  { name: 'popup-nosite', surface: 'popup', path: '/popup/popup.html?seedrecents=1', state: 'empty' },
  { name: 'popup-offline', surface: 'popup', path: '/popup/popup.html?taburl=https://example.no/?orgnr=984851006', state: 'error', offline: true },
];
