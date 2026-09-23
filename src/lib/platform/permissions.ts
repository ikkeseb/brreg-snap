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
