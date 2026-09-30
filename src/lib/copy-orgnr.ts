// The clipboard write every copy action goes through (org.nr, «Kopier
// sammendrag»). navigator.clipboard.writeText works in extension
// contexts without a `clipboardWrite` manifest permission as long as
// the call lives in a user-gesture stack — inside a click handler,
// before any other await (that gesture is what lets it through). The
// buttons and their feedback are src/lib/view/components/copy-feedback.ts.

// Write `text` to the clipboard; false when the browser refused. A
// silent failure reads as "copied" to the user, who then pastes the
// wrong thing elsewhere, so every caller shows the outcome.
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
