// Scrubbing of data source names from outward-facing output.
//
// The real source names are confidential: they are allowed in logs, code comments and
// project documentation, but must NEVER appear in outward-facing output — MCP tool
// responses, MCP resources or the REST API, neither on success nor in error texts.
// Nothing about the sources (name, kind, fetch time) is exposed to clients at all.

// The full source host name (including subdomains like prodapp.* and the .ru zone),
// as well as the "bare" source name in arbitrary text
const SOURCE_NAMES_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:mosmetro|metrobook)(?:\.[a-z]{2,})?/gi;

/**
 * Safety net at the output boundary: strips real source names from text (primarily from
 * internal error messages) before the text goes out to an MCP or REST client.
 */
export const hideSourceNames = (text: string): string => text.replace(SOURCE_NAMES_RE, '[data source]');
