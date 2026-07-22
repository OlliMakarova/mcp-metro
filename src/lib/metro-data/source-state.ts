// Состояние слоя данных метро для оповещений: по результату обновления (origin)
// вычисляется один из четырёх уровней, а сообщение в Telegram отправляется только
// при ПЕРЕХОДЕ между уровнями (алерт по фронту, а не по уровню) — и при ухудшении,
// и при восстановлении. Модуль чистый: без обращений к сети, конфигурации и SDK.

import { TRefreshOrigin } from './refresh.js';
import { IMetroDataset } from './types.js';

/**
 * Уровни состояния слоя данных (от лучшего к худшему):
 *  ok     — свежие полные данные mosmetro.ru;
 *  backup — mosmetro недоступен, работаем на свежем резервном metrobook.ru;
 *  disk   — оба источника недоступны, работаем с дисковой копии;
 *  none   — данных нет вообще (кеш пуст, маршрутизация возвращает ошибку).
 */
export type TMetroDataState = 'ok' | 'backup' | 'disk' | 'none';

export const stateFromOrigin = (origin: TRefreshOrigin): TMetroDataState => {
  switch (origin) {
    case 'mosmetro-fresh':
      return 'ok';
    case 'metrobook-fresh':
      return 'backup';
    case 'mosmetro-disk':
    case 'metrobook-disk':
      return 'disk';
    case 'none':
      return 'none';
  }
};

const formatDate = (iso: string | undefined): string => {
  if (!iso) {
    return 'неизвестной даты';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'неизвестной даты' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
};

/**
 * Текст оповещения о переходе между состояниями. Возвращает null, если состояние
 * не изменилось (оповещать не о чем).
 */
export const buildStateChangeMessage = (
  serviceName: string,
  prev: TMetroDataState,
  next: TMetroDataState,
  dataset: IMetroDataset | null,
): string | null => {
  if (prev === next) {
    return null;
  }
  switch (next) {
    case 'ok':
      return (
        `✅ ${serviceName}: источник mosmetro.ru снова доступен — данные метро полные, ` +
        `закрытия и ремонты учитываются.`
      );
    case 'backup':
      return (
        `⚠️ ${serviceName}: источник mosmetro.ru недоступен. Данные обновлены с резервного ` +
        `metrobook.ru: маршруты строятся, но закрытия станций, вагоны и наземный транспорт недоступны.`
      );
    case 'disk':
      return (
        `⚠️ ${serviceName}: оба источника (mosmetro.ru и metrobook.ru) недоступны. ` +
        `Используется дисковая копия (${dataset?.source ?? '?'}) от ${formatDate(dataset?.schemaFetchedAt)}; ` +
        `устаревшие сведения о закрытиях удалены.`
      );
    case 'none':
      return (
        `🛑 ${serviceName}: данные метро получить не удалось — оба источника недоступны, ` +
        `дисковой копии нет. Построение маршрутов будет возвращать ошибку до восстановления источников.`
      );
  }
};
