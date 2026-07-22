import { IResourceData } from 'fa-mcp-sdk';

import { getMetroDatasetOrNull } from './lib/metro-data/cache.js';
import { toPublicSource } from './lib/metro-data/public-source.js';

/**
 * Resources of the metro MCP server. Content is generated dynamically from the active dataset,
 * so it always reflects the most recently loaded schema.
 */

const LINE_KIND_LABEL: Record<string, string> = {
  metro: 'линия метро',
  mcc: 'МЦК (Московское центральное кольцо)',
  mcd: 'МЦД (Московские центральные диаметры)',
};

/** List of metro lines in markdown format */
const renderLines = (): string => {
  const dataset = getMetroDatasetOrNull();
  if (!dataset) {
    return '# Линии Московского метро\n\nДанные метро временно недоступны.';
  }
  const rows = dataset.lines
    .map((l) => `| ${l.id} | ${l.name?.ru ?? '—'} | ${LINE_KIND_LABEL[l.kind] ?? l.kind} | ${l.color ?? '—'} |`)
    .join('\n');
  return `# Линии Московского метро (метро, МЦК, МЦД)

Всего линий: ${dataset.lines.length}.

| Код | Название | Тип | Цвет |
|-----|----------|-----|------|
${rows}`;
};

/** Metro data status and freshness in markdown format */
const renderStatus = (): string => {
  const dataset = getMetroDatasetOrNull();
  if (!dataset) {
    return `# Состояние данных метро

Данные метро временно недоступны (источники не отвечают, локальной копии нет).`;
  }
  // Real data source names are confidential — only a neutral label goes out
  const sourceName =
    toPublicSource(dataset.source) === 'primary' ? 'основной (полный набор сведений)' : 'резервный (базовый набор)';
  return `# Состояние данных метро

- Источник: ${sourceName}
- Схема скачана: ${dataset.schemaFetchedAt}
- Уведомления скачаны: ${dataset.notificationsFetchedAt ?? 'нет'}
- Станций: ${dataset.stations.length}
- Линий: ${dataset.lines.length}
- Перегонов и переходов: ${dataset.edges.length}
- Действующих уведомлений о ремонтах/закрытиях: ${dataset.notifications?.length ?? 0}`;
};

export const customResources: IResourceData[] = [
  {
    uri: 'metro://lines',
    name: 'Линии Московского метро',
    description: 'Список всех линий метрополитена, МЦК и МЦД с названиями, типом и цветом.',
    mimeType: 'text/markdown',
    content: () => renderLines(),
  },
  {
    uri: 'metro://status',
    name: 'Состояние данных метро',
    description: 'Источник и свежесть загруженных данных: дата схемы, число станций, линий и действующих уведомлений.',
    mimeType: 'text/markdown',
    content: () => renderStatus(),
  },
];
