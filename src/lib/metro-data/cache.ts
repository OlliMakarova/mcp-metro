// Кеш текущего набора данных метро в памяти процесса.
//
// Держит один активный IMetroDataset. Производные структуры (граф маршрутизации,
// индекс неточного поиска) строятся ленивo в своих модулях и мемоизируются по
// идентичности объекта dataset (WeakMap), поэтому смена набора данных автоматически
// приводит к их перестроению без явных подписок.

import { IMetroDataset, MetroDataUnavailableError } from './types.js';

let currentDataset: IMetroDataset | null = null;

/** Устанавливает активный набор данных (null — очистить кеш) */
export const setMetroDataset = (dataset: IMetroDataset | null): void => {
  currentDataset = dataset;
};

/** Есть ли в кеше данные */
export const hasMetroData = (): boolean => currentDataset !== null;

/** Активный набор данных или null */
export const getMetroDatasetOrNull = (): IMetroDataset | null => currentDataset;

/**
 * Активный набор данных. Если кеш пустой (оба источника недоступны и на диске нет копии),
 * бросает MetroDataUnavailableError — вызывающий код должен показать эту ошибку пользователю.
 */
export const getMetroDataset = (): IMetroDataset => {
  if (!currentDataset) {
    throw new MetroDataUnavailableError();
  }
  return currentDataset;
};
