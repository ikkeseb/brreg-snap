// Browser-API shim for previewing the real built popup/details pages in
// a plain browser tab against the live brreg API. Loaded as a classic
// script before the module entry, so globals.js sees `browser` already
// defined and leaves it alone.
//
// Drive it with URL params:
//   ?taburl=https://www.dnb.no&tabtitle=DNB  -> real resolution cascade
//   ?orgnr=984851006                          -> direct load (details)
//   (no params)                               -> empty state
(function () {
  'use strict';

  // --- in-memory storage areas -----------------------------------
  function makeArea() {
    const data = new Map();
    return {
      async get(keys) {
        const out = {};
        const list =
          typeof keys === 'string'
            ? [keys]
            : Array.isArray(keys)
              ? keys
              : keys && typeof keys === 'object'
                ? Object.keys(keys)
                : [...data.keys()];
        for (const k of list) {
          if (data.has(k)) out[k] = data.get(k);
        }
        return out;
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) data.set(k, v);
      },
      async remove(keys) {
        const list = typeof keys === 'string' ? [keys] : keys;
        for (const k of list) data.delete(k);
      },
    };
  }

  // regnskapsregisteret sends no CORS headers (enhetsregisteret does).
  // The extension bypasses CORS via host_permissions; the harness
  // reroutes those calls through serve.mjs's server-side proxy.
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    const PREFIX = 'https://data.brreg.no/regnskapsregisteret/';
    if (url.startsWith(PREFIX)) {
      return realFetch('/regnskap-proxy/' + url.slice(PREFIX.length), init);
    }
    return realFetch(input, init);
  };

  const params = new URLSearchParams(location.search);
  const tabUrl = params.get('taburl') ?? '';
  const tabTitle = params.get('tabtitle') ?? '';

  const noop = () => {};

  const sessionArea = makeArea();
  if (params.get('seedrecents') === '1') {
    void sessionArea.set({
      'recent-companies': [
        { orgnr: '984851006', navn: 'DNB BANK ASA', ts: 3 },
        { orgnr: '923609016', navn: 'EQUINOR ASA', ts: 2 },
        { orgnr: '997550970', navn: 'FINN.NO AS', ts: 1 },
      ],
    });
  }

  globalThis.browser = {
    runtime: {
      getURL: (path) => new URL('../' + path, location.href).href,
      sendMessage: async () => {
        throw new Error('shim: no listener');
      },
      onMessage: { addListener: noop, removeListener: noop },
      getContexts: async () => [],
    },
    tabs: {
      query: async () => [
        { url: tabUrl, title: tabTitle, id: 1, windowId: 1 },
      ],
    },
    storage: {
      session: sessionArea,
      local: makeArea(),
      onChanged: { addListener: noop, removeListener: noop },
    },
    permissions: {
      contains: async () => false,
      request: async () => false,
      remove: async () => true,
      onRemoved: { addListener: noop, removeListener: noop },
    },
    sidePanel: {
      setOptions: async () => {},
      open: async () => {},
    },
    sidebarAction: {
      setPanel: async () => {},
      isOpen: async () => false,
      open: async () => {},
    },
    menus: { create: noop, onClicked: { addListener: noop } },
    contextMenus: { create: noop, onClicked: { addListener: noop } },
  };
  globalThis.chrome = globalThis.browser;
})();
