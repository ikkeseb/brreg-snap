// Permission helpers shared by the panel and the loaders.

// Membership test on a `permissions.Permissions` object.
//
// @types/firefox-webext-browser 143 types `Permissions.permissions` as a
// union of array types (`OptionalPermission[] | OptionalOnlyPermission[]`),
// and `.includes()` on a union of arrays narrows its argument to `never`.
// Widening to `readonly string[]` here keeps that cast in one place
// instead of at every call site. Pure: it never touches `browser`.
export function hasPermission(
  perms: browser.permissions.Permissions,
  name: string,
): boolean {
  const list = perms.permissions as readonly string[] | undefined;
  return list?.includes(name) ?? false;
}

// The manifest's one host permission. Both engines let the user
// withhold it after install, and Regnskapsregisteret's figures can't
// be fetched without it (docs/notes/permissions-model.md
// § withheld-host-permission).
export const BRREG_ORIGINS: browser.permissions.Permissions = {
  origins: ['https://data.brreg.no/*'],
};

// Whether the data.brreg.no grant is held. A browser that can't say
// counts as holding it: a plain failure is then reported as one, and
// the view never blames a permission it couldn't check.
export async function hasBrregAccess(): Promise<boolean> {
  try {
    return await browser.permissions.contains(BRREG_ORIGINS);
  } catch {
    return true;
  }
}

// «Gi tilgang»: asks for the grant. Call it first thing in the click
// handler, with no await before it (permissions-model.md
// § gesture-stack). The namespace is passed in so the panel's
// controller is tested with a fake. Refused without a prompt reads as
// not granted.
export function requestBrregAccess(
  permissions: Pick<typeof browser.permissions, 'request'>,
): Promise<boolean> {
  return permissions.request(BRREG_ORIGINS).catch(() => false);
}

// permissions.onAdded: whether this grant includes data.brreg.no.
export function grantsBrregAccess(perms: browser.permissions.Permissions): boolean {
  const list = perms.origins as readonly string[] | undefined;
  return BRREG_ORIGINS.origins!.some((o) => list?.includes(o) ?? false);
}
