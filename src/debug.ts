// Debug output of the metro MCP server, following the fa-mcp-sdk convention
// (see fa-mcp-sdk src/core/debug.ts): one Debug instance per category, enabled via
// a DEBUG substring and guarded by `.enabled` at call sites.

import { bold, cyan, reset } from 'af-color';
import { Debug } from 'af-tools-ts';

/**
 * Fuzzy station search: when a tool response contains clarification alternatives,
 * prints a console table of those alternatives (names, ids, similarity score).
 * Enable: DEBUG=fuzzy-search
 */
export const debugFuzzySearch = Debug('fuzzy-search', {
  noTime: false,
  noPrefix: false,
  prefixColor: bold + cyan,
  messageColor: reset,
});
