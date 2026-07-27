import { IResourceData } from 'fa-mcp-sdk';

import { getMetroDatasetOrNull } from './lib/metro-data/cache.js';
import { pickName } from './lib/metro-data/localized-name.js';
import { IMetroDataset, TMetroCity } from './lib/metro-data/types.js';
import { routesWidgetResources } from './tools/widget/widget-resource.js';

/**
 * Resources of the metro MCP server. Content is generated dynamically from the active datasets
 * (one per city), so it always reflects the most recently loaded schemas.
 */

const LINE_KIND_LABEL: Record<string, string> = {
  metro: 'metro line',
  mcc: 'MCC (Moscow Central Circle)',
  mcd: 'MCD (Moscow Central Diameters)',
};

const CITY_TITLE: Record<TMetroCity, string> = { moscow: 'Moscow', spb: 'Saint Petersburg' };

const CITIES: TMetroCity[] = ['moscow', 'spb'];

/** Lines of one city as a markdown section */
const renderCityLines = (city: TMetroCity, dataset: IMetroDataset | null): string => {
  if (!dataset) {
    return `## ${CITY_TITLE[city]}

Metro data is temporarily unavailable.`;
  }
  const rows = dataset.lines
    .map(
      (l) =>
        `| ${l.id} | ${pickName(l.name, 'en') || '—'} | ${LINE_KIND_LABEL[l.kind] ?? l.kind} | ${l.color ?? '—'} |`,
    )
    .join('\n');
  return `## ${CITY_TITLE[city]} (${dataset.lines.length} lines)

| Id | Name | Kind | Color |
|----|------|------|-------|
${rows}`;
};

/** List of metro lines of both cities in markdown format */
const renderLines = (): string => {
  const sections = CITIES.map((city) => renderCityLines(city, getMetroDatasetOrNull(city)));
  return `# Metro lines (Moscow: metro, MCC, MCD; Saint Petersburg: metro)

${sections.join('\n\n')}`;
};

/** Data summary of one city as a markdown section */
const renderCityStatus = (city: TMetroCity, dataset: IMetroDataset | null): string => {
  if (!dataset) {
    return `## ${CITY_TITLE[city]}

Metro data is temporarily unavailable.`;
  }
  return `## ${CITY_TITLE[city]}

- Stations: ${dataset.stations.length}
- Lines: ${dataset.lines.length}
- Track segments and transfers: ${dataset.edges.length}
- Active repair/closure notifications: ${dataset.notifications?.length ?? 0}`;
};

/** Metro data summary in markdown format (no source or freshness details — confidential) */
const renderStatus = (): string => {
  const sections = CITIES.map((city) => renderCityStatus(city, getMetroDatasetOrNull(city)));
  return `# Metro data status

${sections.join('\n\n')}`;
};

export const customResources: IResourceData[] = [
  {
    uri: 'metro://lines',
    name: 'Metro lines (Moscow and Saint Petersburg)',
    description: 'List of all lines of both cities with names, kind and color.',
    mimeType: 'text/markdown',
    content: () => renderLines(),
  },
  {
    uri: 'metro://status',
    name: 'Metro data status',
    description:
      'Summary of the loaded data per city: number of stations, lines, track segments and active notifications.',
    mimeType: 'text/markdown',
    content: () => renderStatus(),
  },
  ...routesWidgetResources,
];
