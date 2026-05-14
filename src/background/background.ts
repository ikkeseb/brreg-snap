// The popup is the entire UI surface — this service worker exists only
// because MV3 requires one. It wakes when the popup runs and otherwise
// stays idle. No long-running tasks, no message handlers, no listeners
// on tab navigation.
//
// Tab-switch sidebar refresh is intentionally driven from the popup
// (which gets activeTab on each click) rather than from background
// listeners. Background listeners would require the `tabs` permission
// to read URLs for non-granted tabs, and broad URL access is a hard
// "no" in CLAUDE.md § Security constraints.

export {};
