import { IResourceData } from 'fa-mcp-sdk';

import { getMetroDatasetOrNull } from './lib/index.js';

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
  return (
    '# Линии Московского метро (метро, МЦК, МЦД)\n\n' +
    `Всего линий: ${dataset.lines.length}.\n\n` +
    '| Код | Название | Тип | Цвет |\n|-----|----------|-----|------|\n' +
    rows
  );
};

/** Состояние и свежесть данных метро в формате markdown */
const renderStatus = (): string => {
  const dataset = getMetroDatasetOrNull();
  if (!dataset) {
    return '# Состояние данных метро\n\nДанные метро временно недоступны (источники не отвечают, локальной копии нет).';
  }
  const sourceName =
    dataset.source === 'mosmetro' ? 'mosmetro.ru (полный набор сведений)' : 'metrobook.ru (базовый набор)';
  return (
    '# Состояние данных метро\n\n' +
    `- Источник: ${sourceName}\n` +
    `- Схема скачана: ${dataset.schemaFetchedAt}\n` +
    `- Уведомления скачаны: ${dataset.notificationsFetchedAt ?? 'нет'}\n` +
    `- Станций: ${dataset.stations.length}\n` +
    `- Линий: ${dataset.lines.length}\n` +
    `- Перегонов и переходов: ${dataset.edges.length}\n` +
    `- Действующих уведомлений о ремонтах/закрытиях: ${dataset.notifications?.length ?? 0}`
  );
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
