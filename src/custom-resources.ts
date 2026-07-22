import { IResourceData } from 'fa-mcp-sdk';

import { getMetroDatasetOrNull } from './lib/metro-data/cache.js';
import { pickName } from './lib/metro-data/localized-name.js';

/**
 * Resources of the metro MCP server. Content is generated dynamically from the active dataset,
 * so it always reflects the most recently loaded schema.
 */

const LINE_KIND_LABEL: Record<string, string> = {
  metro: 'metro line',
  mcc: 'MCC (Moscow Central Circle)',
  mcd: 'MCD (Moscow Central Diameters)',
};

/** List of metro lines in markdown format */
const renderLines = (): string => {
  const dataset = getMetroDatasetOrNull();
  if (!dataset) {
    return `# Moscow Metro lines
    
Metro data is temporarily unavailable.`;
  }
  const rows = dataset.lines
    .map(
      (l) =>
        `| ${l.id} | ${pickName(l.name, 'en') || '—'} | ${LINE_KIND_LABEL[l.kind] ?? l.kind} | ${l.color ?? '—'} |`,
    )
    .join('\n');
  return `# Moscow Metro lines (metro, MCC, MCD)

Total lines: ${dataset.lines.length}.

| Id | Name | Kind | Color |
|----|------|------|-------|
${rows}`;
};

/** Metro data summary in markdown format (no source or freshness details — confidential) */
const renderStatus = (): string => {
  const dataset = getMetroDatasetOrNull();
  if (!dataset) {
    return `# Metro data status

Metro data is temporarily unavailable.`;
  }
  return `# Metro data status

- Stations: ${dataset.stations.length}
- Lines: ${dataset.lines.length}
- Track segments and transfers: ${dataset.edges.length}
- Active repair/closure notifications: ${dataset.notifications?.length ?? 0}`;
};

export const customResources: IResourceData[] = [
  {
    uri: 'metro://lines',
    name: 'Moscow Metro lines',
    description: 'List of all metro, MCC and MCD lines with names, kind and color.',
    mimeType: 'text/markdown',
    content: () => renderLines(),
  },
  {
    uri: 'metro://status',
    name: 'Metro data status',
    description: 'Summary of the loaded data: number of stations, lines, track segments and active notifications.',
    mimeType: 'text/markdown',
    content: () => renderStatus(),
  },
];
