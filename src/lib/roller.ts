import type { RolleEnhet, Navn, RollerResponse } from '../types/brreg.js';

// Display name of a role subject: a person's joined name parts, or a
// registered entity's name (auditors/accountants are usually firms, so
// a role holder can be an enhet, not a person). Undefined when neither
// carries a usable label.
function roleSubjectName(
  navn: Navn | undefined,
  enhet: RolleEnhet | undefined,
): string | undefined {
  const parts = [navn?.fornavn, navn?.mellomnavn, navn?.etternavn].filter(
    (s): s is string => Boolean(s),
  );
  if (parts.length > 0) return parts.join(' ');
  const enhetNavn = enhet?.navn?.filter(Boolean).join(' ');
  return enhetNavn || undefined;
}

// First active (non-fratrådt) holder of a role, matched on the inner
// role's `type.kode` so it works whether the code names a group (DAGL)
// or a position inside a group (LEDE = styreleder lives under the STYR
// group). Returns a person name or an entity name; undefined when the
// role is absent or every holder has resigned.
export function findRoleHolder(
  roller: RollerResponse,
  kode: string,
): string | undefined {
  for (const group of roller.rollegrupper ?? []) {
    for (const role of group.roller ?? []) {
      if (role.type.kode !== kode) continue;
      if (role.fratraadt) continue;
      const name = roleSubjectName(role.person?.navn, role.enhet);
      if (name) return name;
    }
  }
  return undefined;
}

export function findDagligLeder(
  roller: RollerResponse,
): string | undefined {
  return findRoleHolder(roller, 'DAGL');
}
