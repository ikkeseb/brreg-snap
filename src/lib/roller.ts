import type { RollerResponse } from '../types/brreg.js';

export function findDagligLeder(
  roller: RollerResponse,
): string | undefined {
  for (const group of roller.rollegrupper ?? []) {
    if (group.type.kode !== 'DAGL') continue;
    for (const role of group.roller ?? []) {
      if (role.fratraadt) continue;
      const navn = role.person?.navn;
      const parts = [navn?.fornavn, navn?.mellomnavn, navn?.etternavn].filter(
        (s): s is string => Boolean(s),
      );
      if (parts.length > 0) return parts.join(' ');
    }
  }
  return undefined;
}
