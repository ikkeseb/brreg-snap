// «Kobling»: how the site on screen relates to the company shown. The
// one signal no other lookup tool gives — the other four describe the
// company, this one describes whether the site has any right to it.
// Pure: derived from the resolution method (provenance) and the
// company's registered hjemmeside, nothing fetched. See
// docs/notes/resolution.md § kobling and the KoblingKind comments in
// ./types.ts.

import {
  hjemmesideDomains,
  hostnameLabel,
  registrableDomain,
} from '../hostname-score.js';
import { decodePunycode } from '../punycode.js';
import type { ResolutionMethod } from '../resolution-method.js';
import type { Enhet } from '../../types/brreg.js';
import type { Kobling, KoblingKind, Tone } from './types.js';

// Company directories: sites whose pages show OTHER companies' orgnrs
// by design. Generic knowledge about a handful of well-known lookup
// sites, deliberately short — not a hostname → orgnr table (CLAUDE.md
// § No curated data). A directory's own company page still reads
// 'registered' when brreg ties the domain to it.
export const DIRECTORY_DOMAINS: ReadonlySet<string> = new Set([
  'brreg.no',
  'proff.no',
  'purehelp.no',
  'forvalt.no',
  '1881.no',
  'gulesider.no',
  'regnskapstall.no',
]);

export interface KoblingInput {
  method: ResolutionMethod | undefined;
  // The site on screen (the tab's hostname).
  host: string | undefined;
  enhet: Pick<Enhet, 'hjemmeside'>;
}

// Registrable domains are compared in their ACE form (the URL parser's
// hostname); the copy shows them the way people type them.
function displayDomain(domain: string): string {
  return domain
    .split('.')
    .map((label) => {
      if (!label.startsWith('xn--')) return label;
      return decodePunycode(label.slice(4)) ?? label;
    })
    .join('.');
}

function kobling(
  kind: KoblingKind,
  tone: Tone,
  host: string,
  value: string,
  detail: string | undefined,
  registeredDomain: string | undefined,
): Kobling {
  const out: Kobling = {
    key: 'kobling',
    label: 'Kobling',
    value,
    tone,
    kind,
    host,
  };
  if (detail !== undefined) out.detail = detail;
  if (registeredDomain !== undefined) out.registeredDomain = registeredDomain;
  return out;
}

// undefined when there is no site in play: a manual pick, an in-panel
// drill-in, or no host (a panel hint, a restored history entry).
export function deriveKobling({
  method,
  host,
  enhet,
}: KoblingInput): Kobling | undefined {
  if (!host || !method || method === 'manual' || method === 'drill-in') {
    return undefined;
  }
  const bare = host.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
  if (!bare) return undefined;
  const hostDomain = registrableDomain(host) ?? bare;
  const site = displayDomain(hostDomain);
  const registered = hjemmesideDomains(enhet.hjemmeside);
  const reg = registered[0];
  const regShown = reg === undefined ? undefined : displayDomain(reg);

  // The registry ties this site to the company, however it was found.
  if (registered.includes(hostDomain)) {
    return kobling(
      'registered',
      'ok',
      host,
      `${site} er registrert hjemmeside`,
      undefined,
      hostDomain,
    );
  }

  switch (method) {
    case 'url-param':
    case 'url-path':
    case 'title':
      if (DIRECTORY_DOMAINS.has(hostDomain)) {
        return kobling(
          'directory',
          'neutral',
          host,
          `Oppslag på ${site}`,
          'katalogside, ikke selskapets egen',
          reg,
        );
      }
      if (reg !== undefined) {
        return kobling(
          'mismatch',
          'danger',
          host,
          `Registrert hjemmeside er ${regShown}`,
          `ikke ${site}`,
          reg,
        );
      }
      return kobling(
        'site-claims',
        'neutral',
        host,
        'Siden oppgir selv dette org.nr',
        'ingen hjemmeside registrert',
        undefined,
      );
    case 'host-auto':
      if (reg !== undefined) {
        return kobling(
          'other-site',
          'warn',
          host,
          `Registrert hjemmeside er ${regShown}`,
          'funnet via navnet',
          reg,
        );
      }
      return kobling(
        'name-guess',
        'warn',
        host,
        `Gjettet ut fra navnet «${hostnameLabel(host) ?? site}»`,
        'ingen hjemmeside registrert',
        undefined,
      );
    case 'host-pick':
      return kobling(
        'chosen',
        'neutral',
        host,
        `Valgt av deg for ${site}`,
        undefined,
        reg,
      );
  }
}
