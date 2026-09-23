import type { Rolle, RollerResponse } from '../types/brreg.js';

// True when the holder has left the role. brreg marks this with
// `avregistrert` since 2026-01 and removed the older `fratraadt` on
// 2026-06-16. Both are honoured: reading the dead field costs nothing,
// and a departed board member shown as current is the worse failure.
export function isResigned(role: Rolle): boolean {
  return role.avregistrert === true || role.fratraadt === true;
}

// Display name of a role subject: a person's joined name parts, a
// registered entity's name (auditors/accountants are usually firms, so
// a role holder can be an enhet, not a person), or a bankruptcy
// trustee's name. Undefined when none carries a usable label.
export function roleSubjectName(role: Rolle): string | undefined {
  const navn = role.person?.navn;
  const parts = [navn?.fornavn, navn?.mellomnavn, navn?.etternavn].filter(
    (s): s is string => Boolean(s),
  );
  if (parts.length > 0) return parts.join(' ');
  const enhetNavn = role.enhet?.navn?.filter(Boolean).join(' ');
  if (enhetNavn) return enhetNavn;
  return role.bostyrer?.navn?.trim() || undefined;
}

// First current (not resigned) holder of a role, matched on the inner
// role's `type.kode` so it works whether the code names a group (DAGL)
// or a position inside a group (LEDE = styreleder lives under the STYR
// group). Returns a person, entity or trustee name; undefined when the
// role is absent or every holder has resigned.
export function findRoleHolder(
  roller: RollerResponse,
  kode: string,
): string | undefined {
  for (const group of roller.rollegrupper ?? []) {
    for (const role of group.roller ?? []) {
      if (role.type.kode !== kode) continue;
      if (isResigned(role)) continue;
      const name = roleSubjectName(role);
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
