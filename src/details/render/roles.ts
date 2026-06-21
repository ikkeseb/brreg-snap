import type {
  Person,
  Rolle,
  RolleEnhet,
  RolleGruppe,
  RollerResponse,
} from '../../types/brreg.js';
import { $, emptyLine, makeNavLink } from './dom.js';

const rolesBody = $('roles-body');

type Navigate = (orgnr: string) => void;

export function renderRoles(
  roller: RollerResponse,
  onNavigate: Navigate,
): void {
  rolesBody.innerHTML = '';
  const groups = roller.rollegrupper ?? [];
  const nonEmpty = groups.filter((g) => (g.roller?.length ?? 0) > 0);
  if (nonEmpty.length === 0) {
    rolesBody.appendChild(emptyLine('Ingen registrerte roller.'));
    return;
  }
  for (const group of nonEmpty) {
    rolesBody.appendChild(renderRoleGroup(group, onNavigate));
  }
}

function renderRoleGroup(group: RolleGruppe, onNavigate: Navigate): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'role-group';

  const title = document.createElement('p');
  title.className = 'role-group-title';
  title.textContent = group.type.beskrivelse ?? group.type.kode;
  wrap.appendChild(title);

  const ul = document.createElement('ul');
  ul.className = 'role-list';
  for (const role of group.roller ?? []) {
    ul.appendChild(renderRoleItem(role, onNavigate));
  }
  wrap.appendChild(ul);
  return wrap;
}

function renderRoleItem(role: Rolle, onNavigate: Navigate): HTMLLIElement {
  const li = document.createElement('li');
  if (role.fratraadt) li.classList.add('fratraadt');

  const roleLabel =
    role.type.beskrivelse && role.type.beskrivelse !== role.type.kode
      ? role.type.beskrivelse
      : role.type.kode;

  const person = personName(role.person);
  if (person) {
    li.append(`${roleLabel}: ${person}`);
  } else if (role.enhet) {
    li.append(`${roleLabel}: `);
    li.append(renderEnhetSubject(role.enhet, onNavigate));
  } else {
    li.append(roleLabel);
  }

  if (role.fratraadt) li.append(' (fratrådt)');
  // Status of the subject itself, independent of fratrådt: a deceased
  // person or a deleted (dissolved) entity is still a live record here.
  if (role.person?.erDoed) li.appendChild(statusBadge('død'));
  if (role.enhet?.erSlettet) li.appendChild(statusBadge('slettet'));
  return li;
}

// A company role-holder (auditor, accountant, corporate board member).
// Made a drill-in link only when it has an orgnr AND is not slettet —
// a dissolved entity would 404 on /enheter, so it stays plain text.
function renderEnhetSubject(
  enhet: RolleEnhet,
  onNavigate: Navigate,
): Node {
  const navn = enhet.navn?.filter(Boolean).join(' ') ?? '';
  const orgnr = enhet.organisasjonsnummer;
  const text = navn && orgnr ? `${navn} (${orgnr})` : navn || orgnr || '';
  if (orgnr && !enhet.erSlettet && text) {
    const a = makeNavLink(orgnr, text, onNavigate);
    a.className = 'role-link';
    return a;
  }
  return document.createTextNode(text);
}

function personName(person: Person | undefined): string | undefined {
  const parts = [
    person?.navn?.fornavn,
    person?.navn?.mellomnavn,
    person?.navn?.etternavn,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function statusBadge(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'role-status';
  span.textContent = ` (${text})`;
  return span;
}
