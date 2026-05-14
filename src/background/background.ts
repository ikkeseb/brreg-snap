// The popup is the entire UI surface — this service worker exists only
// because MV3 requires one. It wakes when the popup runs and otherwise
// stays idle. No long-running tasks, no message handlers, no listeners
// on tab navigation.

export {};
