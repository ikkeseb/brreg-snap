import type {
  Person,
  Rolle,
  RolleEnhet,
  RolleGruppe,
  RollerResponse,
} from '../../types/brreg.js';
import { $, emptyLine } from './dom.js';

const rolesBody = $('roles-body');

export function renderRoles(roller: RollerResponse): void {
  rolesBody.innerHTML = '';
  const groups = roller.rollegrupper ?? [];
  const nonEmpty = groups.filter((g) => (g.roller?.length ?? 0) > 0);
  if (nonEmpty.length === 0) {
    rolesBody.appendChild(emptyLine('Ingen registrerte roller.'));
    return;
  }
  for (const group of nonEmpty) {
    rolesBody.appendChild(renderRoleGroup(group));
  }
}

function renderRoleGroup(group: RolleGruppe): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'role-group';

  const title = document.createElement('p');
  title.className = 'role-group-title';
  title.textContent = group.type.beskrivelse ?? group.type.kode;
  wrap.appendChild(title);

  const ul = document.createElement('ul');
  ul.className = 'role-list';
  for (const role of group.roller ?? []) {
    ul.appendChild(renderRoleItem(role));
  }
  wrap.appendChild(ul);
  return wrap;
}

function renderRoleItem(role: Rolle): HTMLLIElement {
  const li = document.createElement('li');
  if (role.fratraadt) li.classList.add('fratraadt');

  const subject = formatRoleSubject(role.person, role.enhet);
  const roleLabel =
    role.type.beskrivelse && role.type.beskrivelse !== role.type.kode
      ? role.type.beskrivelse
      : role.type.kode;
  li.textContent = subject
    ? `${roleLabel}: ${subject}`
    : roleLabel;
  if (role.fratraadt) li.textContent += ' (fratrådt)';
  return li;
}

function formatRoleSubject(
  person: Person | undefined,
  enhet: RolleEnhet | undefined,
): string {
  if (person?.navn) {
    const parts = [
      person.navn.fornavn,
      person.navn.mellomnavn,
      person.navn.etternavn,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }
  if (enhet) {
    const navn = enhet.navn?.join(' ') ?? '';
    const orgnr = enhet.organisasjonsnummer;
    if (navn && orgnr) return `${navn} (${orgnr})`;
    if (navn) return navn;
    if (orgnr) return orgnr;
  }
  return '';
}
