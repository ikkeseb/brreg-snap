// Konsern (group) structure: the /konsernstruktur fetcher and the pure
// derivation the panel renders from. See docs/notes/brreg-api.md
// § konsernstruktur for what the live endpoint returns.

import { brregFetch } from './brreg.js';
import { cacheGet, cacheSet } from './session-cache.js';
import type { KonsernNode } from '../types/brreg.js';

const API = 'https://data.brreg.no/enhetsregisteret/api/konsernstruktur';

export interface KonsernRef {
  orgnr: string;
  navn: string;
}

export interface KonsernParent extends KonsernRef {
  // The parent's stake, formatted «100 %» / «99,99 %». Absent when
  // brreg gives none or gives text («Indirekte mor»).
  grunnlag?: string;
}

export interface KonsernChild extends KonsernRef {
  // This child's link to the company shown, formatted like
  // KonsernParent.grunnlag.
  grunnlag?: string;
  // How many direct children this child has in turn (0 = a leaf).
  childCount: number;
}

export interface Konsern {
  // 'top': the company is the group's top parent (morselskap).
  role: 'top' | 'member';
  top: KonsernRef;
  // The direct parent. Absent for the top.
  parent?: KonsernParent;
  // Top → the company shown, both inclusive. [top] for the top.
  path: KonsernRef[];
  // Direct children of the company shown, sorted by name.
  children: KonsernChild[];
  // Companies in the group other than the top, each counted once.
  groupSize: number;
}

// A 404 is a real answer («not in a group»), so it is cached too; the
// wrapper tells it apart from a cache miss.
interface CachedKonsern {
  root: KonsernNode | null;
}

function isKonsernNode(value: unknown): value is KonsernNode {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Partial<Record<keyof KonsernNode, unknown>>;
  return (
    typeof node.organisasjonsnummer === 'string' &&
    typeof node.navn === 'string' &&
    (node.children === undefined || Array.isArray(node.children))
  );
}

// The whole group `orgnr` belongs to, rooted at its top parent — even
// when `orgnr` is a subsidiary. undefined = not in a group (404, or a
// top with no children). Rejects on network failure, any other status
// and an unexpected shape; loadCompany maps that to «couldn't ask».
// Only worth calling when Enhet.erIKonsern is true.
export async function fetchKonsernstruktur(
  orgnr: string,
): Promise<KonsernNode | undefined> {
  const key = `konsern:${orgnr}`;
  const cached = await cacheGet<CachedKonsern>(key);
  if (cached && 'root' in cached) return cached.root ?? undefined;

  const res = await brregFetch(`${API}/${orgnr}`);
  if (res.status === 404) {
    await cacheSet<CachedKonsern>(key, { root: null });
    return undefined;
  }
  if (!res.ok) {
    throw new Error(`brreg konsernstruktur API returned ${res.status}.`);
  }
  const data: unknown = await res.json();
  if (!isKonsernNode(data)) {
    throw new Error('brreg konsernstruktur returned an unexpected response shape.');
  }
  const root = data.children && data.children.length > 0 ? data : null;
  await cacheSet<CachedKonsern>(key, { root });
  return root ?? undefined;
}

// «100%», «100 %», «99,99%», «95,0%» → a number; text → undefined.
function parseGrunnlag(raw: string | undefined): number | undefined {
  const m = raw?.trim().match(/^(\d+(?:[.,]\d+)?)\s*%$/);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

// Same shape as formatPercent in format.ts (nb-NO digits, no-break
// space before %), but keeps up to two decimals: rounding 99,99 % to
// «100 %» would state full ownership that isn't there.
export function formatGrunnlag(raw: string | undefined): string | undefined {
  const n = parseGrunnlag(raw);
  if (n === undefined) return undefined;
  return `${n.toLocaleString('nb-NO', { maximumFractionDigits: 2 })}\u00a0%`;
}

// One place a company sits in the tree. A company owned through several
// parents has one occurrence under each.
interface Occurrence {
  node: KonsernNode;
  // The occurrence of the parent this one hangs under; undefined for
  // the root.
  up?: Occurrence;
}

// Which of a company's links is its real parent: a controlling link
// (KDAT/KMOR) beats a partial stake (KGRL), then the larger stake wins,
// then the first one brreg listed. Live examples (docs/notes/brreg-api.md
// § konsernstruktur-duplicates): AKER ASA sits under TRG HOLDING AS
// (KMOR 66,99%) and under THE RESOURCE GROUP TRG AS (KGRL 1,19%).
function linkRank(node: KonsernNode): [number, number] {
  const control = node.knytningsform?.kode === 'KGRL' ? 0 : 1;
  return [control, parseGrunnlag(node.grunnlag) ?? -1];
}

function outranks(a: KonsernNode, b: KonsernNode): boolean {
  const [ac, ap] = linkRank(a);
  const [bc, bp] = linkRank(b);
  return ac !== bc ? ac > bc : ap > bp;
}

const byName = new Intl.Collator('nb');

// Where `orgnr` sits in `tree`. undefined when it isn't in the tree or
// the tree is only a root. One pass over the tree, O(n).
export function deriveKonsern(
  tree: KonsernNode,
  orgnr: string,
): Konsern | undefined {
  if (!isKonsernNode(tree)) return undefined;
  const rootOrgnr = tree.organisasjonsnummer;
  // The best-ranked occurrence per company.
  const best = new Map<string, Occurrence>();
  // parent orgnr → child orgnr → the child's best-ranked link to it.
  const kids = new Map<string, Map<string, KonsernNode>>();

  const rootOcc: Occurrence = { node: tree };
  best.set(rootOrgnr, rootOcc);
  const stack: Occurrence[] = [rootOcc];
  while (stack.length > 0) {
    const occ = stack.pop()!;
    const parentOrgnr = occ.node.organisasjonsnummer;
    const pending: Occurrence[] = [];
    for (const child of occ.node.children ?? []) {
      if (!isKonsernNode(child)) continue;
      const id = child.organisasjonsnummer;
      const childOcc: Occurrence = { node: child, up: occ };
      if (id !== rootOrgnr) {
        const seen = best.get(id);
        if (!seen || outranks(child, seen.node)) best.set(id, childOcc);
      }
      let siblings = kids.get(parentOrgnr);
      if (!siblings) kids.set(parentOrgnr, (siblings = new Map<string, KonsernNode>()));
      const link = siblings.get(id);
      if (!link || outranks(child, link)) siblings.set(id, child);
      pending.push(childOcc);
    }
    // Reversed so the walk visits brreg's order (ties go to the first
    // listed).
    for (let i = pending.length - 1; i >= 0; i--) stack.push(pending[i]!);
  }

  const self = best.get(orgnr);
  const groupSize = best.size - 1;
  if (!self || groupSize === 0) return undefined;

  const ref = (node: KonsernNode): KonsernRef => ({
    orgnr: node.organisasjonsnummer,
    navn: node.navn,
  });
  const top = ref(tree);

  const children: KonsernChild[] = [...(kids.get(orgnr)?.values() ?? [])]
    .map((child) => {
      const grunnlag = formatGrunnlag(child.grunnlag);
      return {
        ...ref(child),
        ...(grunnlag ? { grunnlag } : {}),
        childCount: kids.get(child.organisasjonsnummer)?.size ?? 0,
      };
    })
    .sort((a, b) => byName.compare(a.navn, b.navn));

  if (!self.up) {
    return { role: 'top', top, path: [top], children, groupSize };
  }

  const grunnlag = formatGrunnlag(self.node.grunnlag);
  const parent: KonsernParent = {
    ...ref(self.up.node),
    ...(grunnlag ? { grunnlag } : {}),
  };
  return {
    role: 'member',
    top,
    parent,
    path: pathTo(self, best),
    children,
    groupSize,
  };
}

// Top → self, following each company's best-ranked parent so the path
// agrees with the parent every other view shows. If those links ever
// loop (a malformed tree), fall back to the literal chain above self.
function pathTo(self: Occurrence, best: Map<string, Occurrence>): KonsernRef[] {
  const chain: KonsernRef[] = [];
  const visited = new Set<string>();
  let cur: Occurrence | undefined = self;
  while (cur) {
    const id = cur.node.organisasjonsnummer;
    if (visited.has(id)) {
      return literalChain(self);
    }
    visited.add(id);
    chain.push({ orgnr: id, navn: cur.node.navn });
    cur = cur.up ? best.get(cur.up.node.organisasjonsnummer) : undefined;
  }
  return chain.reverse();
}

function literalChain(self: Occurrence): KonsernRef[] {
  const chain: KonsernRef[] = [];
  for (let cur: Occurrence | undefined = self; cur; cur = cur.up) {
    chain.push({ orgnr: cur.node.organisasjonsnummer, navn: cur.node.navn });
  }
  return chain.reverse();
}

// One line for the header / overview:
//   top:                 «Morselskap i et konsern med 55 selskaper»
//   parent is the top:   «Del av konsern: EQUINOR ASA (100 %)»
//   parent further down: «Del av konsern: EQUINOR ASA (via EQUINOR
//                        ENERGY AS, 100 %)»
// The stake belongs to the direct parent, so it is only printed next
// to the top's name when the top IS the direct parent.
export function konsernLine(k: Konsern): string {
  if (k.role === 'top') {
    const count = (k.groupSize + 1).toLocaleString('nb-NO');
    return `Morselskap i et konsern med ${count} selskaper`;
  }
  const parent = k.parent;
  const detail =
    !parent || parent.orgnr === k.top.orgnr
      ? parent?.grunnlag
      : [`via ${parent.navn}`, parent.grunnlag].filter(Boolean).join(', ');
  return detail
    ? `Del av konsern: ${k.top.navn} (${detail})`
    : `Del av konsern: ${k.top.navn}`;
}
