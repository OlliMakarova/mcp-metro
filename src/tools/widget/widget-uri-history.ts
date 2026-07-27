// The ui:// addresses the route widget has been published under.
//
// A host does not embed the widget into a chat message — it stores the ui:// ADDRESS it saw at the
// time of the answer and re-reads that address every single time the card is displayed, months
// later included. An address the server stops serving therefore does not merely go stale: every
// card already sitting in the user's history turns into "widget unavailable" the moment the widget
// changes. The same hits brand-new cards for a few minutes after a release, while the host still
// answers from its cached tool list and hands out the previous address.
//
// So every past address keeps resolving, to the CURRENT html. That is not a compromise but the
// right content: the widget is a renderer and the route data comes from the signed link stored in
// the message, so an old card rendered by today's widget shows the same route — with today's fixes.
//
// The address stays content-versioned all the same: hosts cache widget html by address with no
// expiry (the mem-bot host has neither a time-to-live nor an explicit invalidation), so a fixed
// address would freeze the widget at whatever build a host happened to fetch first.
//
// This module deliberately holds nothing but data — no file reads, no `import.meta` — so the test
// that guards the list can import it directly.

/** ui:// address of a widget build, by the first 8 hex chars of its sha256 */
export const widgetUri = (hash: string): string => `ui://mos-metro/routes.${hash}.html`;

/**
 * Content hashes of every widget build published before the current one, newest first.
 *
 * KEEP THIS LIST UP TO DATE: whenever `routes-widget.html` changes, add the hash it had before the
 * change. `tests/lib/widget-uri-history.test.ts` derives the full set from the file's git history
 * and fails when an entry is missing, so a forgotten hash surfaces while the change is still being
 * made rather than as a wave of dead cards in production.
 */
export const LEGACY_WIDGET_HASHES: string[] = ['abcf6799', '54c73629', '76584d46', '4274c9d1', '9549f90a', '49200f70'];
