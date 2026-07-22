// Высокоуровневый поиск маршрутов: варианты (алгоритм Йена) с раскладкой на этапы
// и всей доступной информацией о маршруте. Состав ответа зависит от богатства
// источника данных: при работе от metrobook необязательные поля просто отсутствуют.

import {
  ILocalizedName,
  IMetroDataset,
  IStationExit,
  IWagonHint,
  TLineKind,
  TMetroSource,
  TNotificationStatus,
} from '../metro-data/types.js';
import { IGraphEdge, IRouteGraph, getRouteGraph } from './graph.js';
import { yenKShortestPaths } from './yen.js';

export interface IRouteStationInfo {
  id: number;
  name: ILocalizedName;
  lineId: number;
}

export interface ILineInfo {
  id: number;
  name?: ILocalizedName;
  color?: string;
  kind: TLineKind;
  /** Линия относится к Московским центральным диаметрам */
  isMcd: boolean;
  /** Линия относится к Московскому центральному кольцу */
  isMcc: boolean;
}

/** Этап «поездка по линии»: последовательные перегоны одной линии */
export interface IRouteLegRide {
  kind: 'ride';
  line?: ILineInfo;
  timeSec: number;
  /** Все станции этапа по порядку, включая начальную и конечную */
  stations: IRouteStationInfo[];
}

/** Этап «пересадка»: пеший переход между станциями узла */
export interface IRouteLegTransfer {
  kind: 'transfer';
  fromStation: IRouteStationInfo;
  toStation: IRouteStationInfo;
  timeSec: number;
  /** Переход по улице */
  isGround: boolean;
  /** Рекомендации, в какой вагон садиться (только при данных mosmetro) */
  wagons?: IWagonHint[];
  /** Ребро добавлено уведомлением как временный обход закрытого участка */
  isAlternative?: boolean;
}

export type TRouteLeg = IRouteLegRide | IRouteLegTransfer;

/** Маршруты наземного транспорта у станции (из описаний выходов в город) */
export interface IGroundTransport {
  bus: string[];
  trolleybus: string[];
  tram: string[];
}

/** Сведения о конечной точке маршрута (станции отправления или назначения) */
export interface IRouteEndpoint {
  station: IRouteStationInfo;
  line?: ILineInfo;
  /** Время в секундах от входа с улицы до платформы (не входит в totalTimeSec) */
  enterTimeSec?: number;
  /** Время в секундах от платформы до выхода в город (не входит в totalTimeSec) */
  exitTimeSec?: number;
  groundTransport?: IGroundTransport;
  services?: string[];
  exits?: IStationExit[];
}

/** Предупреждение по станции вдоль маршрута (ремонт эскалатора, закрытые выходы и т. п.) */
export interface IRouteWarning {
  stationId: number;
  stationName: string;
  status: TNotificationStatus;
  title?: string;
  description?: string;
}

export interface IRouteVariant {
  /** Общее время маршрута в секундах (сумма перегонов и переходов, без входа/выхода) */
  totalTimeSec: number;
  /** Общее время, округлённое до минут (как показывает сайт mosmetro.ru) */
  totalTimeMin: number;
  rideTimeSec: number;
  transferTimeSec: number;
  transfersCount: number;
  legs: TRouteLeg[];
  departure: IRouteEndpoint;
  arrival: IRouteEndpoint;
  warnings: IRouteWarning[];
}

export interface IFindRoutesResult {
  source: TMetroSource;
  schemaFetchedAt: string;
  /** Учтены ли закрытия и ремонты (true только при свежих уведомлениях mosmetro) */
  closuresApplied: boolean;
  variants: IRouteVariant[];
}

export interface IFindRoutesOpts {
  /** Сколько вариантов маршрута вернуть (по умолчанию 3) */
  k?: number;
  /** Момент, на который применяются закрытия (по умолчанию — сейчас) */
  at?: Date;
  /** Штраф в секундах за пересадку (по умолчанию 0 — время перехода уже в графе) */
  transferPenalty?: number;
}

// ─── Вспомогательные сборщики ────────────────────────────────────────────────

const stationInfo = (graph: IRouteGraph, id: number): IRouteStationInfo => {
  const s = graph.stations.get(id);
  if (!s) {
    throw new Error(`Станция с id=${id} отсутствует в данных`);
  }
  return { id: s.id, name: s.name, lineId: s.lineId };
};

const lineInfo = (graph: IRouteGraph, lineId: number | undefined): ILineInfo | undefined => {
  if (lineId === undefined) {
    return undefined;
  }
  const l = graph.lines.get(lineId);
  if (!l) {
    return undefined;
  }
  return {
    id: l.id,
    ...(l.name ? { name: l.name } : {}),
    ...(l.color ? { color: l.color } : {}),
    kind: l.kind,
    isMcd: l.kind === 'mcd',
    isMcc: l.kind === 'mcc',
  };
};

const splitRoutes = (value: string | undefined): string[] =>
  (value ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

const groundTransport = (exits: IStationExit[] | undefined): IGroundTransport | undefined => {
  if (!exits?.length) {
    return undefined;
  }
  const gt: IGroundTransport = { bus: [], trolleybus: [], tram: [] };
  for (const e of exits) {
    gt.bus.push(...splitRoutes(e.bus));
    gt.trolleybus.push(...splitRoutes(e.trolleybus));
    gt.tram.push(...splitRoutes(e.tram));
  }
  gt.bus = [...new Set(gt.bus)];
  gt.trolleybus = [...new Set(gt.trolleybus)];
  gt.tram = [...new Set(gt.tram)];
  return gt.bus.length || gt.trolleybus.length || gt.tram.length ? gt : undefined;
};

const endpoint = (graph: IRouteGraph, id: number): IRouteEndpoint => {
  const s = graph.stations.get(id)!;
  const gt = groundTransport(s.exits);
  const line = lineInfo(graph, s.lineId);
  return {
    station: stationInfo(graph, id),
    ...(line ? { line } : {}),
    ...(s.enterTimeSec !== undefined ? { enterTimeSec: s.enterTimeSec } : {}),
    ...(s.exitTimeSec !== undefined ? { exitTimeSec: s.exitTimeSec } : {}),
    ...(gt ? { groundTransport: gt } : {}),
    ...(s.services?.length ? { services: s.services } : {}),
    ...(s.exits?.length ? { exits: s.exits } : {}),
  };
};

const buildLegs = (graph: IRouteGraph, edges: IGraphEdge[]): TRouteLeg[] => {
  const legs: TRouteLeg[] = [];
  for (const e of edges) {
    if (e.kind === 'ride') {
      const last = legs[legs.length - 1];
      if (last && last.kind === 'ride' && lastLegLineId(last) === e.lineId) {
        last.timeSec += e.timeSec;
        last.stations.push(stationInfo(graph, e.to));
      } else {
        const line = lineInfo(graph, e.lineId);
        legs.push({
          kind: 'ride',
          ...(line ? { line } : {}),
          timeSec: e.timeSec,
          stations: [stationInfo(graph, e.from), stationInfo(graph, e.to)],
        });
      }
    } else {
      legs.push({
        kind: 'transfer',
        fromStation: stationInfo(graph, e.from),
        toStation: stationInfo(graph, e.to),
        timeSec: e.timeSec,
        isGround: !!e.isGround,
        ...(e.wagons?.length ? { wagons: e.wagons } : {}),
        ...(e.isAlternative ? { isAlternative: true } : {}),
      });
    }
  }
  return legs;
};

const lastLegLineId = (leg: IRouteLegRide): number | undefined => leg.line?.id;

const collectWarnings = (graph: IRouteGraph, edges: IGraphEdge[]): IRouteWarning[] => {
  const stationIds = new Set<number>();
  for (const e of edges) {
    stationIds.add(e.from);
    stationIds.add(e.to);
  }
  const result: IRouteWarning[] = [];
  for (const id of stationIds) {
    for (const w of graph.warnings.get(id) ?? []) {
      result.push({
        stationId: id,
        stationName: graph.stations.get(id)?.name.ru ?? String(id),
        status: w.status,
        ...(w.title ? { title: w.title } : {}),
        ...(w.description ? { description: w.description } : {}),
      });
    }
  }
  return result;
};

// ─── Публичный интерфейс ─────────────────────────────────────────────────────

/**
 * Ищет до k вариантов маршрута между двумя станциями (id вершин графа).
 * Бросает ошибку, если станция неизвестна или закрыта на момент `at`.
 */
export const findRoutes = (
  dataset: IMetroDataset,
  fromId: number,
  toId: number,
  opts: IFindRoutesOpts = {},
): IFindRoutesResult => {
  const { k = 3, at = new Date(), transferPenalty } = opts;
  const graph = getRouteGraph(dataset, at);

  if (!graph.stations.has(fromId)) {
    throw new Error(`Станция отправления с id=${fromId} отсутствует в данных`);
  }
  if (!graph.stations.has(toId)) {
    throw new Error(`Станция назначения с id=${toId} отсутствует в данных`);
  }
  if (graph.closedStations.has(fromId)) {
    throw new Error(`Станция отправления закрыта: ${graph.closedStations.get(fromId)}`);
  }
  if (graph.closedStations.has(toId)) {
    throw new Error(`Станция назначения закрыта: ${graph.closedStations.get(toId)}`);
  }

  const dijkstraOpts = transferPenalty !== undefined ? { transferPenalty } : {};
  const raw = yenKShortestPaths(graph, fromId, toId, k, dijkstraOpts);

  const variants: IRouteVariant[] = raw.map(({ edges }) => {
    let rideTimeSec = 0;
    let transferTimeSec = 0;
    let transfersCount = 0;
    for (const e of edges) {
      if (e.kind === 'ride') {
        rideTimeSec += e.timeSec;
      } else {
        transferTimeSec += e.timeSec;
        transfersCount += 1;
      }
    }
    const totalTimeSec = rideTimeSec + transferTimeSec + (transferPenalty ?? 0) * transfersCount;
    return {
      totalTimeSec,
      totalTimeMin: Math.round(totalTimeSec / 60),
      rideTimeSec,
      transferTimeSec,
      transfersCount,
      legs: buildLegs(graph, edges),
      departure: endpoint(graph, fromId),
      arrival: endpoint(graph, toId),
      warnings: collectWarnings(graph, edges),
    };
  });

  return {
    source: dataset.source,
    schemaFetchedAt: dataset.schemaFetchedAt,
    closuresApplied: !!dataset.notifications,
    variants,
  };
};

/**
 * Поиск маршрутов между группами станций (одноимённые станции разных линий):
 * перебирает все пары «отправление × назначение», объединяет варианты и возвращает
 * k лучших по времени. Пары, где станция закрыта или пути нет, молча пропускаются;
 * если не нашлось ни одного варианта — бросается ошибка первой неудачной пары.
 */
export const findBestRoutes = (
  dataset: IMetroDataset,
  fromIds: number[],
  toIds: number[],
  opts: IFindRoutesOpts = {},
): IFindRoutesResult => {
  const { k = 3 } = opts;
  const allVariants: IRouteVariant[] = [];
  let firstError: Error | null = null;
  let base: IFindRoutesResult | null = null;

  for (const fromId of fromIds) {
    for (const toId of toIds) {
      if (fromId === toId) {
        continue;
      }
      try {
        const res = findRoutes(dataset, fromId, toId, opts);
        base = base ?? res;
        allVariants.push(...res.variants);
      } catch (e) {
        firstError = firstError ?? (e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  if (!base) {
    throw firstError ?? new Error('Не удалось построить маршрут: не заданы станции отправления/назначения');
  }

  // Убираем дубликаты (одинаковая последовательность станций) и берём k лучших
  const seen = new Set<string>();
  const variants = allVariants
    .sort((a, b) => a.totalTimeSec - b.totalTimeSec)
    .filter((v) => {
      const key = v.legs
        .map((l) =>
          l.kind === 'ride' ? l.stations.map((s) => s.id).join('-') : `T${l.fromStation.id}-${l.toStation.id}`,
        )
        .join('|');
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, k);

  return { ...base, variants };
};
