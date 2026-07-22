// Построение графа маршрутизации из единого набора данных IMetroDataset
// с применением активных на заданный момент закрытий и ремонтов.
//
// Вершины — станции (пересадочный узел = несколько станций, по одной на линию),
// рёбра — перегоны (kind='ride') и пешие переходы (kind='transfer'), вес — секунды.
// «Штраф за пересадку» уже зашит в граф в виде времени перехода.

import { IMetroDataset, IMetroEdge, IMetroLine, IMetroStation, TNotificationStatus } from '../metro-data/types.js';

export interface IGraphEdge {
  from: number;
  to: number;
  timeSec: number;
  kind: 'ride' | 'transfer';
  edgeId: string;
  lineId?: number;
  isGround?: boolean;
  wagons?: IMetroEdge['wagons'];
  isAlternative?: boolean;
}

/** Предупреждение по станции из уведомлений (ремонт эскалатора, закрытие выхода и т. п.) */
export interface IStationWarning {
  status: TNotificationStatus;
  title?: string;
  description?: string;
}

export interface IRouteGraph {
  stations: Map<number, IMetroStation>;
  lines: Map<number, IMetroLine>;
  /** Список смежности: stationId -> исходящие рёбра */
  adj: Map<number, IGraphEdge[]>;
  /** Закрытые станции: stationId -> причина */
  closedStations: Map<number, string>;
  /** Предупреждения по станциям (статусы EMERGENCY/INFO — на проезд не влияют) */
  warnings: Map<number, IStationWarning[]>;
  /** Момент, на который применены уведомления */
  at: Date;
}

/**
 * Строит граф на момент `at` (по умолчанию — сейчас).
 * Порядок применения уведомлений:
 *   1) отобрать активные (startDate <= at <= endDate);
 *   2) удалить рёбра со статусом CLOSED;
 *   3) добавить альтернативные (обходные) рёбра;
 *   4) станции CLOSED исключить как точки входа/выхода/пересадки;
 *   5) статусы EMERGENCY/INFO сохранить как предупреждения.
 * Важно: EMERGENCY — это лишь предупреждающий значок, НЕ закрытие.
 */
export const buildRouteGraph = (dataset: IMetroDataset, at: Date = new Date()): IRouteGraph => {
  const stations = new Map(dataset.stations.map((s) => [s.id, s]));
  const lines = new Map(dataset.lines.map((l) => [l.id, l]));

  const closedStations = new Map<number, string>();
  const closedEdgeIds = new Set<string>();
  const extraEdges: IMetroEdge[] = [];
  const warnings = new Map<number, IStationWarning[]>();

  for (const n of dataset.notifications ?? []) {
    const start = new Date(n.startDate);
    const end = new Date(n.endDate);
    if (!(start <= at && at <= end)) {
      continue; // уведомление не активно на момент at
    }
    for (const s of n.stations) {
      if (!stations.has(s.stationId)) {
        continue; // уведомление ссылается на станцию, которой нет в схеме
      }
      if (s.status === 'CLOSED') {
        closedStations.set(s.stationId, s.description ?? n.title ?? 'Станция закрыта');
      } else {
        const list = warnings.get(s.stationId) ?? [];
        list.push({
          status: s.status,
          ...(s.title ? { title: s.title } : {}),
          ...(s.description ? { description: s.description } : {}),
        });
        warnings.set(s.stationId, list);
      }
    }
    for (const edgeId of n.closedEdgeIds) {
      closedEdgeIds.add(edgeId);
    }
    extraEdges.push(...n.alternativeEdges);
  }

  const adj = new Map<number, IGraphEdge[]>();
  for (const id of stations.keys()) {
    adj.set(id, []);
  }

  const addDirected = (e: IMetroEdge, from: number, to: number): void => {
    if (!stations.has(from) || !stations.has(to)) {
      return; // защита от битых ссылок в данных
    }
    adj.get(from)!.push({
      from,
      to,
      timeSec: e.timeSec,
      kind: e.kind,
      edgeId: e.edgeId,
      ...(e.lineId !== undefined ? { lineId: e.lineId } : {}),
      ...(e.isGround ? { isGround: true } : {}),
      ...(e.wagons ? { wagons: e.wagons } : {}),
      ...(e.isAlternative ? { isAlternative: true } : {}),
    });
  };

  for (const e of [...dataset.edges, ...extraEdges]) {
    if (closedEdgeIds.has(e.edgeId)) {
      continue;
    }
    addDirected(e, e.fromId, e.toId);
    if (e.bi) {
      addDirected(e, e.toId, e.fromId);
    }
  }

  // Закрытая станция: нельзя начинать/заканчивать маршрут и делать пересадку через неё.
  // Проезд «сквозь» оставляем возможным, только если перегоны не закрыты явно
  // (в реальных уведомлениях закрытие станции сопровождается закрытием её перегонов).
  for (const id of closedStations.keys()) {
    if (!adj.has(id)) {
      continue;
    }
    adj.set(
      id,
      adj.get(id)!.filter((e) => e.kind !== 'transfer'),
    );
    for (const edges of adj.values()) {
      for (let i = edges.length - 1; i >= 0; i--) {
        if (edges[i]!.kind === 'transfer' && edges[i]!.to === id) {
          edges.splice(i, 1);
        }
      }
    }
  }

  return { stations, lines, adj, closedStations, warnings, at };
};

// ─── Мемоизация графа по набору данных и дню ────────────────────────────────

const graphCache = new WeakMap<IMetroDataset, Map<string, IRouteGraph>>();

/**
 * Граф для набора данных на момент `at` с кешированием. Ключ кеша — календарные сутки:
 * уведомления имеют суточную гранулярность обновления, перестраивать граф на каждый запрос
 * не нужно. Смена dataset автоматически сбрасывает кеш (WeakMap по идентичности объекта).
 */
export const getRouteGraph = (dataset: IMetroDataset, at: Date = new Date()): IRouteGraph => {
  let byDay = graphCache.get(dataset);
  if (!byDay) {
    byDay = new Map();
    graphCache.set(dataset, byDay);
  }
  const dayKey = at.toISOString().slice(0, 10);
  let graph = byDay.get(dayKey);
  if (!graph) {
    graph = buildRouteGraph(dataset, at);
    byDay.set(dayKey, graph);
    // Ограничиваем размер: держим не более 4 «дней» на набор данных
    if (byDay.size > 4) {
      const oldest = byDay.keys().next().value;
      if (oldest !== undefined) {
        byDay.delete(oldest);
      }
    }
  }
  return graph;
};
