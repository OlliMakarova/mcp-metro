// Сборка исчерпывающих сведений о физической станции (пересадочном узле) из набора данных.
//
// Станция задаётся идентификаторами её платформ (вершин графа) — обычно это одна вершина,
// а для пересадочного узла несколько (по одной на линию). Результат — единый структурный
// объект, пригодный и для ответа REST в формате JSON, и для отрисовки в markdown для агента.
// Богатство сведений зависит от источника данных: при работе от резервного metrobook.ru
// необязательные поля (выходы, услуги, расписание) просто отсутствуют.

import {
  IMetroDataset,
  IGeoPoint,
  ILocalizedName,
  IStationExit,
  IStationWorkTimeDay,
  ITrainScheduleEntry,
  TLineKind,
  TNotificationStatus,
} from './metro-data/types.js';
import { getRouteGraph } from './routing/graph.js';
import { getStationClusters } from './station-search/station-clusters.js';

export interface IStationLineRef {
  id: number;
  name?: string;
  color?: string;
  kind: TLineKind;
  /** Линия относится к Московским центральным диаметрам */
  isMcd: boolean;
  /** Линия относится к Московскому центральному кольцу */
  isMcc: boolean;
}

/** Первый и последний поезд по одному направлению (интервалов движения в данных нет) */
export interface IStationScheduleDir {
  toName?: string;
  /**
   * В какие дни действует время: «чётные»/«нечётные» (числа месяца — поезда ходят по двум
   * чередующимся графикам), при необходимости с уточнением «будни»/«выходные».
   * Отсутствует, если время по направлению одинаково во все дни.
   */
  days?: string;
  first?: string;
  last?: string;
}

/** Наземный транспорт у выходов станции */
export interface IStationGroundTransport {
  bus: string[];
  trolleybus: string[];
  tram: string[];
}

/** Одна платформа станции (одна линия пересадочного узла) */
export interface IStationPlatform {
  stationId: number;
  line?: IStationLineRef;
  /** Время в секундах от входа с улицы до платформы */
  enterTimeSec?: number;
  /** Время в секундах от платформы до выхода в город */
  exitTimeSec?: number;
  services?: string[];
  exits?: IStationExit[];
  groundTransport?: IStationGroundTransport;
  schedule?: IStationScheduleDir[];
  /** Часы работы вестибюлей по дням недели: 7 записей, понедельник — воскресенье */
  workTime?: IStationWorkTimeDay[];
}

/** Предупреждение по станции из уведомлений (ремонт эскалатора, закрытие выхода, лифта и т. п.) */
export interface IStationWarningInfo {
  status: TNotificationStatus;
  title?: string;
  description?: string;
}

export interface IStationInfo {
  name: ILocalizedName;
  /** Идентификатор пересадочного узла */
  clusterId: number;
  location?: IGeoPoint;
  /** Линии, к которым относятся платформы станции */
  lines: IStationLineRef[];
  platforms: IStationPlatform[];
  /** Другие линии узла, доступные пересадкой от указанных платформ */
  interchanges: IStationLineRef[];
  /** Действующие сейчас предупреждения (ремонты, закрытия выходов/лифтов/эскалаторов) */
  warnings: IStationWarningInfo[];
  /** Источник данных: mosmetro (полный) или metrobook (скудный) */
  source: IMetroDataset['source'];
  /** Когда скачана схема (ISO UTC) */
  schemaFetchedAt: string;
  /** Учтены ли действующие закрытия и ремонты (true только при свежих уведомлениях mosmetro) */
  closuresApplied: boolean;
}

const splitRoutes = (value: string | undefined): string[] =>
  (value ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

const groundTransport = (exits: IStationExit[] | undefined): IStationGroundTransport | undefined => {
  if (!exits?.length) {
    return undefined;
  }
  const bus = new Set<string>();
  const trolleybus = new Set<string>();
  const tram = new Set<string>();
  for (const e of exits) {
    for (const r of splitRoutes(e.bus)) {
      bus.add(r);
    }
    for (const r of splitRoutes(e.trolleybus)) {
      trolleybus.add(r);
    }
    for (const r of splitRoutes(e.tram)) {
      tram.add(r);
    }
  }
  if (!bus.size && !trolleybus.size && !tram.size) {
    return undefined;
  }
  return { bus: [...bus], trolleybus: [...trolleybus], tram: [...tram] };
};

const DAY_TYPE_LABEL: Record<string, string> = { EVEN: 'чётные', ODD: 'нечётные' };

const comboKey = (e: ITrainScheduleEntry): string => `${e.dayType ?? ''}|${e.weekend ?? ''}`;

/**
 * Пометка «в какие дни действует время» для группы записей одного направления с одинаковыми
 * временами. Покрытые комбинации «чётность даты × будни/выходные» сводятся к краткому описанию:
 * «чётные», «будни», «нечётные, выходные» и т. п. Если группа покрывает все встречающиеся
 * по направлению комбинации (время едино во все дни) — пометка не нужна, возвращается undefined.
 */
const scheduleDaysLabel = (group: ITrainScheduleEntry[], directionComboCount: number): string | undefined => {
  const combos = new Set(group.map(comboKey));
  if (combos.size >= directionComboCount) {
    return undefined;
  }
  const has = (dayType: string, weekend: boolean): boolean => combos.has(`${dayType}|${weekend}`);
  // Обе чётности, но только будни или только выходные
  if (has('EVEN', false) && has('ODD', false) && !has('EVEN', true) && !has('ODD', true)) {
    return 'будни';
  }
  if (has('EVEN', true) && has('ODD', true) && !has('EVEN', false) && !has('ODD', false)) {
    return 'выходные';
  }
  const parts: string[] = [];
  for (const dayType of ['EVEN', 'ODD']) {
    const label = DAY_TYPE_LABEL[dayType]!;
    if (has(dayType, false) && has(dayType, true)) {
      parts.push(label);
    } else if (has(dayType, false)) {
      parts.push(`${label}, будни`);
    } else if (has(dayType, true)) {
      parts.push(`${label}, выходные`);
    }
  }
  return parts.length ? parts.join('; ') : undefined;
};

const scheduleSummary = (
  scheduleTrains: Record<string, ITrainScheduleEntry[]> | undefined,
): IStationScheduleDir[] | undefined => {
  if (!scheduleTrains) {
    return undefined;
  }
  // По направлению до четырёх записей: комбинации «чётные/нечётные даты × будни/выходные».
  // Времена в них нередко различаются (в текущих данных — у 228 станций из 443), поэтому
  // записи с одинаковыми временами схлопываются в одну строку, а различающиеся получают
  // пометку days, в какие дни это время действует.
  const result: IStationScheduleDir[] = [];
  for (const entries of Object.values(scheduleTrains)) {
    const groups = new Map<string, ITrainScheduleEntry[]>();
    for (const e of entries) {
      const key = `${e.stationToName ?? ''}|${e.first ?? ''}|${e.last ?? ''}`;
      const group = groups.get(key);
      if (group) {
        group.push(e);
      } else {
        groups.set(key, [e]);
      }
    }
    const directionComboCount = new Set(entries.map(comboKey)).size;
    const rows = [...groups.values()].sort((a, b) => (a[0]!.first ?? '').localeCompare(b[0]!.first ?? ''));
    for (const group of rows) {
      const e = group[0]!;
      const days = scheduleDaysLabel(group, directionComboCount);
      result.push({
        ...(e.stationToName ? { toName: e.stationToName } : {}),
        ...(days ? { days } : {}),
        ...(e.first ? { first: e.first } : {}),
        ...(e.last ? { last: e.last } : {}),
      });
    }
  }
  return result.length ? result : undefined;
};

const lineRef = (
  lines: Map<number, { id: number; name?: ILocalizedName; color?: string; kind: TLineKind }>,
  lineId: number | undefined,
): IStationLineRef | undefined => {
  if (lineId === undefined) {
    return undefined;
  }
  const l = lines.get(lineId);
  if (!l) {
    return undefined;
  }
  return {
    id: l.id,
    ...(l.name?.ru ? { name: l.name.ru } : {}),
    ...(l.color ? { color: l.color } : {}),
    kind: l.kind,
    isMcd: l.kind === 'mcd',
    isMcc: l.kind === 'mcc',
  };
};

/**
 * Собирает сведения о станции по идентификаторам её платформ (вершин графа) на момент `at`.
 * Неизвестные идентификаторы молча пропускаются; если ни один не найден — бросается ошибка.
 */
export const buildStationInfo = (dataset: IMetroDataset, stationIds: number[], at: Date = new Date()): IStationInfo => {
  const graph = getRouteGraph(dataset, at);
  const clusters = getStationClusters(dataset);
  const { lines } = graph;

  const ids = stationIds.filter((id) => graph.stations.has(id));
  if (!ids.length) {
    throw new Error('Станция не найдена в данных');
  }

  const first = graph.stations.get(ids[0]!)!;
  const idSet = new Set(ids);

  const platforms: IStationPlatform[] = ids.map((id) => {
    const s = graph.stations.get(id)!;
    const line = lineRef(lines, s.lineId);
    const gt = groundTransport(s.exits);
    const sched = scheduleSummary(s.scheduleTrains);
    return {
      stationId: id,
      ...(line ? { line } : {}),
      ...(s.enterTimeSec !== undefined ? { enterTimeSec: s.enterTimeSec } : {}),
      ...(s.exitTimeSec !== undefined ? { exitTimeSec: s.exitTimeSec } : {}),
      ...(s.services?.length ? { services: s.services } : {}),
      ...(s.exits?.length ? { exits: s.exits } : {}),
      ...(gt ? { groundTransport: gt } : {}),
      ...(sched ? { schedule: sched } : {}),
      ...(s.workTime?.length ? { workTime: s.workTime } : {}),
    };
  });

  // Уникальные линии платформ станции
  const lineList: IStationLineRef[] = [];
  for (const p of platforms) {
    if (p.line && !lineList.some((l) => l.id === p.line!.id)) {
      lineList.push(p.line);
    }
  }

  // Пересадки: линии соседних платформ узла, достижимых переходом, но не входящих
  // в число запрошенных платформ (это «другие линии этой станции»).
  const interchanges: IStationLineRef[] = [];
  for (const e of dataset.edges) {
    if (e.kind !== 'transfer') {
      continue;
    }
    let neighbor: number | undefined;
    if (idSet.has(e.fromId) && !idSet.has(e.toId)) {
      neighbor = e.toId;
    } else if (e.bi && idSet.has(e.toId) && !idSet.has(e.fromId)) {
      neighbor = e.fromId;
    }
    if (neighbor === undefined) {
      continue;
    }
    const ns = graph.stations.get(neighbor);
    if (!ns) {
      continue;
    }
    const ref = lineRef(lines, ns.lineId);
    if (ref && !lineList.some((l) => l.id === ref.id) && !interchanges.some((l) => l.id === ref.id)) {
      interchanges.push(ref);
    }
  }

  // Действующие предупреждения по всем платформам узла
  const warnings: IStationWarningInfo[] = [];
  const seenWarn = new Set<string>();
  for (const id of ids) {
    for (const w of graph.warnings.get(id) ?? []) {
      const key = `${w.status}|${w.title ?? ''}|${w.description ?? ''}`;
      if (seenWarn.has(key)) {
        continue;
      }
      seenWarn.add(key);
      warnings.push(w);
    }
  }

  return {
    name: first.name,
    clusterId: clusters.clusterOf(ids[0]!),
    ...(first.location ? { location: first.location } : {}),
    lines: lineList,
    platforms,
    interchanges,
    warnings,
    source: dataset.source,
    schemaFetchedAt: dataset.schemaFetchedAt,
    closuresApplied: !!dataset.notifications,
  };
};
