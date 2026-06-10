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
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au',
  'co.nz', 'co.za', 'co.jp', 'co.kr',
  'com.br', 'com.mx', 'com.cn', 'com.tr', 'com.pl', 'com.sg',
  'kommune.no', 'fylkeskommune.no',
]);

// Pull the brandable part out of a hostname for use as a search label.
// `www.yara.com` → `yara`, `shop.mestergruppen.no` → `mestergruppen`,
// `nrk.no` → `nrk`. Strips `www.` and the public suffix (single- or
// multi-part), then takes the rightmost remaining label. IDN labels
// arrive punycoded from `new URL().hostname` and are decoded back to
// human text (xn--blbr-roah.no → "blåbær") so name search can match
// æ/ø/å brands. Returns undefined — the pipeline's abstain signal,
// `resolveInternal` short-circuits to band 'none' / manual search —
// when nothing brandable remains: single-label hosts, bare public
// suffixes, labels shorter than 2 chars, or xn-- labels that fail to
// decode (better manual search than querying a raw ACE string that
// can never match a registered name).
export function hostnameLabel(hostname: string): string | undefined {
  const stripped = hostname.replace(/^www\./i, '').toLowerCase();
  const parts = stripped.split('.');
  if (parts.length < 2) return undefined;

  let idx = parts.length - 2;
  if (MULTI_PART_SUFFIXES.has(parts.slice(-2).join('.'))) {
    if (parts.length < 3) return undefined; // host IS a public suffix
    idx = parts.length - 3;
  }

  let base = parts[idx];
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
// wrapped in scheme/path scored as substring (+12) instead of exact
// (+35) and confident matches landed in the picker.
export function normalizeHjemmeside(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/:?#].*$/, '') // drop path, port, query, fragment
    .replace(/\.+$/, ''); // drop trailing dot(s)
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
  // The field is normalized to a bare host first (see
  // normalizeHjemmeside) so "http://www.equinor.com" scores exact
  // against equinor.com, not substring. Bands/weights unchanged:
  // exact > prefix (host plus trailing junk) > substring (visited
  // host buried in a deeper hjemmeside host, e.g. shop.elkjop.no).
  const hjem = normalizeHjemmeside(cand.hjemmeside ?? '');
  const bareHost = host.replace(/^www\./, '').toLowerCase();
  let hjemScore = 0;
  if (hjem) {
    if (hjem === bareHost) {
      hjemScore = 35;
      reasons.push('hjemmeside=exact(+35)');
    } else if (hjem.startsWith(bareHost)) {
      hjemScore = 22;
      reasons.push('hjemmeside=prefix(+22)');
    } else if (hjem.includes(bareHost)) {
      hjemScore = 12;
      reasons.push('hjemmeside=substr(+12)');
    }
  }

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

  if (cand.konkurs || cand.underAvvikling) {
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
