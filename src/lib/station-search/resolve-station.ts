// Определение станции по свободному тексту запроса.
//
// Пользователь вводит название станции на любом из четырёх языков, с опечатками или в
// транслитерации. Задача резолвера — свести это к одному из трёх исходов:
//
//   1. resolved   — уверенно определена ровно одна физическая станция (пересадочный узел).
//                   Возвращаются идентификаторы всех её платформ (вершин графа), пригодные
//                   как точки входа/выхода для построения маршрута.
//   2. ambiguous  — подходит несколько разных станций (разные пересадочные узлы). Нужно,
//                   чтобы пользователь выбрал подходящий вариант из списка.
//   3. not_found  — ни одного достаточно похожего названия не нашлось. Нужно уточнить ввод.
//
// Одноимённые платформы одного пересадочного узла (соединённые переходами) не считаются
// разными вариантами — это одна станция (см. station-clusters.ts). А одноимённые станции
// РАЗНЫХ узлов, между которыми перехода нет («Смоленская» синей и голубой линий), дают
// исход ambiguous.

import { IMetroDataset, TLineKind } from '../metro-data/types.js';
import { fuzzySearchStations, IFuzzySearchOpts } from './search-stations.js';
import { getStationClusters } from './station-clusters.js';

/** Схожесть считается точной, если отличается от 1 не больше чем на эпсилон */
const EXACT_EPS = 1e-9;

/** Одна линия, присутствующая на станции варианта */
export interface IResolveLineRef {
  id: number;
  name?: string;
  color?: string;
  kind: TLineKind;
}

/** Один вариант станции (один пересадочный узел) */
export interface IStationOption {
  /** Идентификатор кластера (пересадочного узла) */
  clusterId: number;
  /** Отображаемое название станции (по-русски) */
  name: string;
  /** Идентификаторы платформ узла среди совпадений — точки входа/выхода для маршрута */
  ids: number[];
  /** Линии, к которым относятся найденные платформы узла */
  lines: IResolveLineRef[];
  /** Максимальная схожесть совпадений узла с запросом (0..1) */
  score: number;
}

export type TStationResolution =
  | { kind: 'resolved'; option: IStationOption }
  | { kind: 'ambiguous'; options: IStationOption[] }
  | { kind: 'not_found' };

/** Максимум вариантов, показываемых при неоднозначности */
const MAX_OPTIONS = 6;

/**
 * Определяет станцию по тексту запроса. При неоднозначности возвращает список вариантов
 * (по одному на пересадочный узел) по убыванию схожести.
 */
export const resolveStation = (
  dataset: IMetroDataset,
  query: string,
  opts: IFuzzySearchOpts = {},
): TStationResolution => {
  const matches = fuzzySearchStations(dataset, query, { limit: 8, ...opts });
  if (!matches.length) {
    return { kind: 'not_found' };
  }

  // При наличии точных совпадений рассматриваем только их: неточные кандидаты — это
  // «шум» от опечаток и в присутствии точного попадания к делу не относятся.
  const exact = matches.filter((m) => m.score >= 1 - EXACT_EPS);
  const candidates = exact.length ? exact : matches;

  const clusters = getStationClusters(dataset);

  // Группируем кандидатов по пересадочным узлам
  const byCluster = new Map<number, IStationOption>();
  for (const m of candidates) {
    const clusterId = clusters.clusterOf(m.station.id);
    let option = byCluster.get(clusterId);
    if (!option) {
      option = { clusterId, name: m.station.name.ru, ids: [], lines: [], score: m.score };
      byCluster.set(clusterId, option);
    }
    option.ids.push(m.station.id);
    option.score = Math.max(option.score, m.score);
    // Представительное имя — у совпадения с наибольшей схожестью
    if (m.score >= option.score) {
      option.name = m.station.name.ru;
    }
    if (m.line && !option.lines.some((l) => l.id === m.line!.id)) {
      option.lines.push({
        id: m.line.id,
        ...(m.line.name?.ru ? { name: m.line.name.ru } : {}),
        ...(m.line.color ? { color: m.line.color } : {}),
        kind: m.line.kind,
      });
    }
  }

  const options = [...byCluster.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  if (options.length === 1) {
    return { kind: 'resolved', option: options[0]! };
  }
  return { kind: 'ambiguous', options: options.slice(0, MAX_OPTIONS) };
};
