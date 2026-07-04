import { renderOrgnrCopy } from '../../lib/copy-orgnr.js';
import { renderFlags } from '../../lib/ui/flags.js';
import { deriveVerdict, renderVerdict } from '../../lib/ui/verdict.js';
import type { Enhet, RegnskapResponse } from '../../types/brreg.js';
import { $ } from './dom.js';

const nameEl = $('name');
const orgnrEl = $('orgnr');
const verdictEl = $('verdict');
const flagsEl = $('flags');

// Header = identity (name, orgnr) + judgment (verdict strip) +
// memberships (quiet registry pills). The primary status lives in the
// verdict strip; renderFlags shows only secondary statuses + registries.
export function renderHeader(
  enhet: Enhet,
  regnskap: RegnskapResponse | undefined,
): void {
  nameEl.textContent = enhet.navn;
  renderOrgnrCopy(orgnrEl, enhet.organisasjonsnummer);
  renderVerdict(verdictEl, deriveVerdict(enhet, regnskap));
  renderFlags(flagsEl, enhet);
}
