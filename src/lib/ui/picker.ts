// «Feil bedrift?»: the reject flow both surfaces share. The picker
// itself is a view component (src/lib/view/components/picker.ts);
// surface-specific side effects (URL params, load tokens, panel
// messages) stay in the callers.

import {
  addRejectedChoice,
  searchByHostnameDetailed,
  type Candidate,
} from '../hostname-search.js';

export type RejectOutcome =
  | { kind: 'picker'; candidates: Candidate[] }
  | { kind: 'empty' };

// «Feil bedrift?»: records the rejection and re-runs the host
// resolution. `orgnrs` is every orgnr the result stood for: the one the
// site gave and, for an underenhet, the parent shown — resolve-tab
// checks rejections against the site's orgnr, the host search against
// the candidates. Resolves undefined when `isStale` says the caller
// moved on meanwhile (the rejections are stored either way; only the
// paint is dropped). `title` keeps the search's word hints
// (hostname-search.ts § title segmentation).
export async function rejectChoice(
  host: string,
  orgnrs: readonly string[],
  title: string | undefined,
  isStale: () => boolean = () => false,
): Promise<RejectOutcome | undefined> {
  for (const orgnr of orgnrs) await addRejectedChoice(host, orgnr);
  if (isStale()) return undefined;
  const detailed = await searchByHostnameDetailed(host, title);
  if (isStale()) return undefined;
  if (detailed && detailed.candidates.length > 0) {
    // Always show the picker (even if a single candidate now wins
    // band='auto') — the user just expressed doubt; let them confirm.
    return { kind: 'picker', candidates: detailed.candidates };
  }
  return { kind: 'empty' };
}
