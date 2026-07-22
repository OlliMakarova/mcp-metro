import { IResourceData } from 'fa-mcp-sdk';

import { getMetroDatasetOrNull } from './lib/metro-data/cache.js';
import { toPublicSource } from './lib/metro-data/public-source.js';

/**
 * Ресурсы MCP-сервера метро. Содержимое формируется динамически из активного набора данных,
 * поэтому оно всегда отражает последнюю загруженную схему.
 */

const LINE_KIND_LABEL: Record<string, string> = {
  metro: 'линия метро',
  mcc: 'МЦК (Московское центральное кольцо)',
  mcd: 'МЦД (Московские центральные диаметры)',
};

/** Список линий метрополитена в формате markdown */
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

/** Состояние и свежесть данных метро в формате markdown */
const renderStatus = (): string => {
  const dataset = getMetroDatasetOrNull();
  if (!dataset) {
    return `# Состояние данных метро

Данные метро временно недоступны (источники не отвечают, локальной копии нет).`;
  }
  // Реальные имена источников засекречены — наружу уходит только нейтральное обозначение
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
