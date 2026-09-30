// The smoke's state list, shared by the specs and the fixture recorder
// (record.mjs visits the same URLs, so every request a state makes has
// a recorded fixture). A redesign adds states here; each entry needs
// only a stable hook: the `data-state` value main#app must reach.

/**
 * @typedef {object} SmokeState
 * @property {string} name         screenshot/test name
 * @property {'panel' | 'popup'} surface
 * @property {string} path         harness URL (served by serve.mjs)
 * @property {'result' | 'picker' | 'empty' | 'error'} state
 * @property {boolean} [offline]   abort every brreg request
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
