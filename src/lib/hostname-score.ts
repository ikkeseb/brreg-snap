// Pure scoring + utilities for hostname → brreg resolution. No network
// access, no storage — depends only on the candidate shape returned
// from brreg's /enheter endpoint. See docs/notes/resolution.md for the
// pipeline overview.

import { decodePunycode } from './punycode.js';
import type { SearchHit } from '../types/brreg.js';

// Fold Nordic letters to ASCII: Ø→O, Å→A, Æ→AE (and lowercase). Brreg
// stores names with Nordic letters; hostnames cannot carry them. The
// label is therefore always ASCII. Without folding, "elkjop" would
// never match "ELKJØP NORGE AS".
export function foldNordic(s: string): string {
  return s
    .replace(/Ø/g, 'O')
    .replace(/ø/g, 'o')
    .replace(/Å/g, 'A')
    .replace(/å/g, 'a')
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae');
}

// Hostnames are ASCII; brreg search does NOT auto-fold Nordic letters
// (?navn=elkjop returns 0, ?navn=elkjøp returns ELKJØP NORGE AS).
// Generate variants by substituting one "o"→"ø" or "a"→"å" per
// position, plus "ae"→"æ" / "aa"→"å" when present. Capped at one
// substitution per position so the set stays small.
export function generateNordicVariants(label: string): string[] {
  const out = new Set<string>([label]);
  for (let i = 0; i < label.length; i++) {
    if (label[i] === 'o') {
      out.add(label.slice(0, i) + 'ø' + label.slice(i + 1));
    }
    if (label[i] === 'a') {
      out.add(label.slice(0, i) + 'å' + label.slice(i + 1));
    }
  }
  if (label.includes('ae')) out.add(label.replace(/ae/g, 'æ'));
  if (label.includes('aa')) out.add(label.replace(/aa/g, 'å'));
  return [...out];
}

// Common multi-part public suffixes. Intentionally NON-exhaustive —
// this is generic TLD knowledge (NOT curated company data, which the
// project bans) covering registries a Norwegian-focused user plausibly
// hits; the full public-suffix list would be ~10k entries of dead
// weight. When the host ends in one of these, the registrable label
// sits one part further left (company.co.uk → "company",
// oslo.kommune.no → "oslo" — not "co" / "kommune").
const MULTI_PART_SUFFIXES = [
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au',
  'co.nz', 'co.za', 'co.jp', 'co.kr',
  'com.br', 'com.mx', 'com.cn', 'com.tr', 'com.pl', 'com.sg',
  'kommune.no', 'fylkeskommune.no',
];

// Hosting platforms that give each customer a subdomain
// (firma.netlify.app, butikk.myshopify.com). The tenant label is the
// brand; the platform label ("netlify", "pages") could only ever match
// an unrelated company. Same kind of generic suffix knowledge as above,
// not curated company data, and just as deliberately short.
// sites.google.com is here so the bare host counts as a suffix: its
// tenant lives in the URL path, which the pipeline never sees, so the
// host abstains instead of resolving to GOOGLE NORWAY AS.
const HOSTING_PLATFORM_SUFFIXES = [
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'netlify.app',
  'vercel.app', 'web.app', 'firebaseapp.com', 'herokuapp.com',
  'onrender.com', 'azurewebsites.net', 'blogspot.com', 'wordpress.com',
  'wixsite.com', 'squarespace.com', 'myshopify.com', 'webflow.io',
  'framer.website', 'notion.site', 'sites.google.com',
];

const PUBLIC_SUFFIXES = new Set([
  ...MULTI_PART_SUFFIXES,
  ...HOSTING_PLATFORM_SUFFIXES,
]);

// TLDs that never have a public registrant: special-use names
// (RFC 6761/6762/7686/8375/9476) plus the de-facto intranet ones.
// Asking brreg about jira.corp.internal or printer.local could only
// leak internal host names into a public API's logs.
const NON_PUBLIC_TLDS = new Set([
  'localhost', 'localdomain', 'local', 'internal', 'intranet', 'lan',
  'home', 'corp', 'arpa', 'test', 'example', 'invalid', 'onion', 'alt',
]);

// The part of a visited host a company actually registers:
// nettbank.dnb.no → dnb.no, shop.company.co.uk → company.co.uk,
// firma.github.io → firma.github.io. Returns undefined — "never ask
// brreg about this host" — for IP literals, single-label and
// intranet/special-use hosts, and hosts that ARE a public suffix.
export function registrableDomain(hostname: string): string | undefined {
  const host = hostname
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/^www\./, '');
  // IPv6 literals arrive bracketed ("[::1]"); single-label hosts
  // (localhost, intranet, extension ids) have no dot.
  if (host.includes(':') || !host.includes('.')) return undefined;
  const parts = host.split('.');
  const tld = parts[parts.length - 1] ?? '';
  // No real TLD is all-numeric, so a numeric one means an IPv4 literal
  // (the URL parser normalises every IPv4 spelling to dotted decimal).
  if (/^\d+$/.test(tld) || NON_PUBLIC_TLDS.has(tld)) return undefined;
  if (PUBLIC_SUFFIXES.has(host)) return undefined;
  // Longest listed suffix first; the registrable part is one label
  // to its left. Unlisted hosts fall back to the last two labels.
  for (let i = 1; i < parts.length - 1; i++) {
    if (PUBLIC_SUFFIXES.has(parts.slice(i).join('.'))) {
      return parts.slice(i - 1).join('.');
    }
  }
  return parts.slice(-2).join('.');
}

// Pull the brandable part out of a hostname for use as a search label:
// the leftmost label of its registrable domain. `www.yara.com` →
// `yara`, `shop.mestergruppen.no` → `mestergruppen`, `firma.pages.dev`
// → `firma`. IDN labels arrive punycoded from `new URL().hostname` and
// are decoded back to human text (xn--blbr-roah.no → "blåbær") so name
// search can match æ/ø/å brands. Returns undefined — the pipeline's
// abstain signal, `resolveInternal` short-circuits to band 'none' /
// manual search without a request — when nothing brandable remains:
// hosts registrableDomain refuses, labels shorter than 2 chars, or
// xn-- labels that fail to decode (better manual search than querying
// a raw ACE string that can never match a registered name).
export function hostnameLabel(hostname: string): string | undefined {
  const domain = registrableDomain(hostname);
  if (!domain) return undefined;

  let base = domain.split('.')[0];
  if (base?.startsWith('xn--')) {
    const decoded = decodePunycode(base.slice(4));
    // Bogus decodes (control chars, punctuation) would just be junk
    // queries — only letters/digits/hyphen pass, like real IDN labels.
    if (!decoded || !/^[\p{L}\p{N}-]+$/u.test(decoded)) return undefined;
    base = decoded.toLowerCase();
  }
  if (!base || base.length < 2) return undefined;
  return base;
}

// Words that strongly suggest a satellite organisation (vennelag,
// pensjonskasse, klubb) rather than the operating company.
const NOISE_WORDS = [
  'VENNELAG', 'VENNER', 'PENSJONSKASSE', 'KLUBB', 'FORENING',
  'STIFTELSEN', 'SUPPORTER', 'ANSATTES', 'SENIOR', 'BEDRIFTSIDRETT',
  'IDRETTSLAG', 'KORPS', 'ARBEIDERLAG', 'VETERAN',
];

// Words that suggest the candidate is a subsidiary/division. NORGE /
// NORWAY / NORDIC / INTERNATIONAL / GROUP / GRUPPEN / HOLDING are
// intentionally NOT here — they routinely name the country-level
// operating company (ELKJØP NORGE AS) or the group parent itself
// (YARA INTERNATIONAL ASA).
const SUBSIDIARY_KEYWORDS = [
  'SVERIGE', 'DANMARK', 'FINLAND',
  'FINANCE', 'FINANS', 'INVEST',
  'FOODS', 'HEALTH', 'SNACKS', 'CARE', 'EIENDOM', 'PROPERTY',
  'ASIA', 'EUROPE', 'GLOBAL', 'IT',
];

const ORG_FORM_WEIGHTS: Record<string, number> = {
  AS: 15, ASA: 28, SA: 12, ORGL: 18, SF: 18,
  DA: 5, ANS: 5,
  FLI: -35, STI: -20, ENK: -25, PERS: -50, NUF: -10, UTLA: -15, PK: -30,
};

export interface ScoreResult {
  score: number;
  reasons: string[];
}

// Brreg's hjemmeside field is free text — "http://www.equinor.com",
// "https://orkla.com/", "tine.no/om", trailing dots, mixed case.
// Reduce it to a bare lowercase host so it compares against the
// visited host like-for-like. Without this, an exact-host hjemmeside
// wrapped in scheme/www/port fell through to a weaker band and
// confident matches landed in the picker.
export function normalizeHjemmeside(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/:?#].*$/, '') // drop path, port, query, fragment
    .replace(/\.+$/, ''); // drop trailing dot(s)
}

interface HjemmesideEntry {
  host: string;
  // False when the entry points at a page on the site rather than the
  // site itself ("www.storebrand.no/eiendom", "nrk.no/urort/artist/…").
  root: boolean;
}

// A free-text field can name more than one site ("a.no, b.no"), so
// split before normalizing — otherwise the second entry survives as
// junk glued onto the first host.
function hjemmesideEntries(raw: string): HjemmesideEntry[] {
  return raw
    .split(/[\s,;]+/)
    .map((entry) => {
      const path = entry
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/^[^/?#]+/, '') // host and port
        .replace(/[?#].*$/, '');
      return { host: normalizeHjemmeside(entry), root: path.length <= 1 };
    })
    .filter((e) => e.host);
}

export function scoreCandidate(
  cand: SearchHit,
  label: string,
  host: string,
): ScoreResult {
  const navn = foldNordic((cand.navn || '').toUpperCase());
  const labelU = foldNordic(label.toUpperCase());
  const formKode = cand.organisasjonsform?.kode ?? '';

  const reasons: string[] = [];

  // Name matching. Prefix bonus is scaled by word count so that ORKLA
  // matches ORKLA ASA (2 words) more strongly than ORKLA FOODS NORGE
  // AS (4 words).
  const wordCount = navn.split(/\s+/).filter(Boolean).length || 1;
  let nameScore = 0;
  if (navn.startsWith(labelU + ' ') || navn === labelU) {
    const ratioBonus = Math.round(20 / wordCount);
    nameScore = 28 + ratioBonus;
    reasons.push(`prefix(+${28 + ratioBonus})`);
  } else if (navn.startsWith(labelU)) {
    nameScore = 22;
    reasons.push('weak-prefix(+22)');
  } else if (
    navn.includes(' ' + labelU + ' ') ||
    navn.endsWith(' ' + labelU)
  ) {
    nameScore = 28;
    reasons.push('word(+28)');
  } else if (navn.includes(labelU)) {
    nameScore = 12;
    reasons.push('substr(+12)');
  }

  // Hjemmeside-felt match. Weighted lower than name match — small
  // associations populate this field more often than parent companies
  // (SHELL VETERANENE for shell.no, drift companies for lieoverflate).
  // Each entry is normalized to a bare host first (see
  // normalizeHjemmeside) so "http://www.equinor.com" scores exact
  // against equinor.com. Matching is on domain-label boundaries only;
  // plain substrings are not a relation (tidsbanken.no contains
  // sbanken.no, vg.nordland.no starts with vg.no):
  //   exact (+35)     — the site itself: the visited host or its
  //                     registrable domain (nettbank.dnb.no still ties
  //                     to www.dnb.no), with no path
  //   page (+12)      — a page on the site: funds, property SPVs and
  //                     artist pages register www.storebrand.no/fond
  //                     or nrk.no/urort/…, and a site has far more of
  //                     those than owners
  //   subdomain (+12) — shop.elkjop.no for elkjop.no
  const bareHost = host
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/^www\./, '');
  const domain = registrableDomain(host) ?? bareHost;
  let hjemScore = 0;
  let hjemReason = '';
  for (const entry of hjemmesideEntries(cand.hjemmeside ?? '')) {
    const sameSite = entry.host === bareHost || entry.host === domain;
    if (sameSite && entry.root) {
      hjemScore = 35;
      hjemReason = 'hjemmeside=exact(+35)';
      break;
    }
    if (sameSite) {
      hjemScore = 12;
      hjemReason = 'hjemmeside=page(+12)';
    } else if (!hjemScore && entry.host.endsWith('.' + domain)) {
      hjemScore = 12;
      hjemReason = 'hjemmeside=subdomain(+12)';
    }
  }
  if (hjemReason) reasons.push(hjemReason);

  // Hard gate: no name AND no hjemmeside relation → drop. Kills
  // unrelated candidates that happen to share org form / employee
  // count (norden.org → NORDAN AS).
  if (nameScore === 0 && hjemScore === 0) {
    return { score: 0, reasons: ['no-relation'] };
  }

  let score = nameScore + hjemScore;

  const formBonus = ORG_FORM_WEIGHTS[formKode] ?? 0;
  if (formBonus) {
    const sign = formBonus >= 0 ? '+' : '';
    score += formBonus;
    reasons.push(`form=${formKode}(${sign}${formBonus})`);
  }

  // Parent vs subsidiary: overordnetEnhet is present only on subsidiaries.
  if (!cand.overordnetEnhet) {
    score += 12;
    reasons.push('top-level(+12)');
  } else {
    score -= 6;
    reasons.push('subsidiary(-6)');
  }

  const ansatte = cand.antallAnsatte ?? 0;
  if (ansatte >= 500) {
    score += 20;
    reasons.push('ansatte>=500(+20)');
  } else if (ansatte >= 100) {
    score += 15;
    reasons.push('ansatte>=100(+15)');
  } else if (ansatte >= 10) {
    score += 8;
    reasons.push('ansatte>=10(+8)');
  } else if (ansatte >= 1) {
    score += 3;
    reasons.push('ansatte>=1(+3)');
  }

  // Subsidiary keywords only count when the label is already matched
  // — otherwise unrelated entities containing these words get
  // penalised for no reason.
  if (nameScore > 0) {
    const matchedSub = SUBSIDIARY_KEYWORDS.find(
      (w) => navn.includes(' ' + w) || navn.includes(w + ' '),
    );
    if (matchedSub) {
      score -= 15;
      reasons.push(`subsidiary-kw=${matchedSub}(-15)`);
    }
  }

  if (cand.registrertIForetaksregisteret) {
    score += 6;
    reasons.push('foretaksreg(+6)');
  }

  const matchedNoise = NOISE_WORDS.find((w) => navn.includes(w));
  if (matchedNoise) {
    score -= 40;
    reasons.push(`noise=${matchedNoise}(-40)`);
  }

  if (wordCount >= 5) {
    score -= 10;
    reasons.push(`long(${wordCount}w)(-10)`);
  } else if (wordCount === 2) {
    score += 10;
    reasons.push('short(2w)(+10)');
  } else if (wordCount === 1) {
    score += 5;
    reasons.push('short(1w)(+5)');
  }

  // The penalty demotes name lookalikes that are winding down. It must
  // not touch an exact hjemmeside tie: then the registry itself says
  // this is the site's own company, and «konkurs» / «under avvikling»
  // is the headline a trust tool exists to show, not noise to rank
  // away (such a site used to fall to «Ingen bedrift identifisert»).
  // Deleted entities need no case here: search never returns them.
  if ((cand.konkurs || cand.underAvvikling) && hjemScore !== 35) {
    score -= 30;
    reasons.push('inactive(-30)');
  }

  return { score, reasons };
}

// Thresholds — tuned against scripts/benchmark-hostname.mjs.
//
// AUTO: top must be confidently above the noise floor (75) AND
// clearly ahead of the runner-up (+10) so kjedebutikker (ELKJØP
// LEKNES vs ELKJØP SVOLVÆR, both 111 via hjemmeside-exact) don't
// auto-resolve.
//
// PICKER: top must be plausible (45) but not confident — surface
// the top 4 with "Ingen av disse" instead of guessing.
const AUTO_THRESHOLD = 75;
const AUTO_MARGIN = 10;
const PICKER_THRESHOLD = 45;

export type ResolutionBand = 'auto' | 'picker' | 'none';

export function decideBand(
  topScore: number,
  runnerUpScore: number | undefined,
): ResolutionBand {
  if (topScore <= 0) return 'none';
  const runner = runnerUpScore ?? 0;
  if (topScore >= AUTO_THRESHOLD && topScore - runner >= AUTO_MARGIN) {
    return 'auto';
  }
  if (topScore >= PICKER_THRESHOLD) return 'picker';
  return 'none';
}
