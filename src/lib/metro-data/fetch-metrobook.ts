// Скачивание и нормализация данных резервного источника — metrobook.ru.
//
// Весь взвешенный граф метро зашит прямо в HTML главной страницы (один запрос GET /):
//   mb.arrSD[sdid] = {sid, lid}          — «станция на линии» (вершина графа)
//   mb.arrS[sid]   = {sdids: [...]}      — физическая станция = группа вершин
//   mb.arrR[rid]   = {ttime, sdid1, sdid2, lid} — перегон, ttime в секундах
//   mb.arrTT[a][b] = секунды             — пересадка; 999999 означает «переход запрещён»
//   mb.arrL[lid]   = {type}              — линия: 0 метро, 1 МЦК, 2 МЦД
// Названия станций — в вёрстке: <span mb_sd_id='NN' class='stName ...'>Название</span>.
//
// Ограничения источника (см. data/metrobook-ru/README.md): названия только русские, у
// пересадочного узла одна подпись, нет закрытий/вагонов/координат/времени входа-выхода,
// точность времени — минута. Часть пробелов закрывает enrichMetrobookFromMosmetroSchema().

import {
  ILocalizedName,
  IMetroDataset,
  IMetroEdge,
  IMetroLine,
  IMetroStation,
  IMetrobookGraphFile,
  TLineKind,
} from './types.js';
import { IMosmetroRawSchema } from './fetch-mosmetro.js';

/** Значение-соглашение «переход запрещён» в таблице пересадок metrobook */
const FORBIDDEN_TRANSFER_SEC = 999_999;

// ─── Скачивание и разбор HTML ────────────────────────────────────────────────

export interface IMetrobookFetchOpts {
  url: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface IMbRuntime {
  arrS: Record<string, { sdids: number[] }>;
  arrSD: Record<string, { sid: number; lid: number }>;
  arrR: Record<string, { ttime: number; sdid1: number; sdid2: number; lid: number }>;
  arrTT: Array<Record<string, number> | undefined>;
  arrDL: unknown[];
  arrL: Record<string, { type: number }>;
  mid?: number;
}

/**
 * Извлекает граф из HTML главной страницы. Бросает понятную ошибку, если вёрстка изменилась.
 * Формат результата совместим с файлом metrobook-graph.json на диске.
 */
export const parseMetrobookHtml = (html: string, fetchedAt: string, sourceUrl: string): IMetrobookGraphFile => {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
  const dataScript = scripts.find((s) => s.includes('mb.arrSD[') && s.includes('mb.arrR['));
  if (!dataScript) {
    throw new Error('metrobook.ru: инлайн-скрипт с данными графа не найден — вёрстка сайта изменилась');
  }

  // Выполняем инлайн-скрипт в изолированном контексте: он только наполняет объект mb.
  // Это тот же приём, что в проверенном скрипте исследования (data/metrobook-ru/fetch-data.js).
  const mb: IMbRuntime = { arrS: {}, arrSD: {}, arrR: {}, arrTT: [], arrDL: [], arrL: {} };
  // eslint-disable-next-line no-new-func
  new Function('mb', dataScript.replace(/var mb = new Object;[^;]*;/, '')).call(null, mb);

  // Названия станций из вёрстки подписей схемы
  const names: Record<string, string> = {};
  for (const m of html.matchAll(/<span mb_sd_id='(\d+)' class='stName[^']*'>([^<]+)<\/span>/g)) {
    names[m[1]!] = (m[2] ?? '')
      .replace(/\\n|\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const graph: IMetrobookGraphFile = {
    source: sourceUrl,
    fetchedAt,
    mapId: Number((dataScript.match(/mb\.mid=(\d+)/) || [])[1] ?? 0),
    lines: Object.fromEntries(Object.entries(mb.arrL).map(([lid, l]) => [lid, { type: l.type }])),
    stationInstances: Object.fromEntries(
      Object.entries(mb.arrSD).map(([sdid, sd]) => [
        sdid,
        { stationId: sd.sid, lineId: sd.lid, name: names[sdid] ?? null },
      ]),
    ),
    stations: Object.fromEntries(
      Object.entries(mb.arrS).map(([sid, s]) => [
        sid,
        { sdids: s.sdids, name: s.sdids.map((d) => names[String(d)]).find(Boolean) ?? null },
      ]),
    ),
    edges: Object.entries(mb.arrR).map(([rid, r]) => ({
      id: Number(rid),
      sdid1: r.sdid1,
      sdid2: r.sdid2,
      lineId: r.lid,
      time: r.ttime,
    })),
    transfers: Object.entries(mb.arrTT).flatMap(([from, row]) =>
      Object.entries(row ?? {}).map(([to, time]) => ({ from: Number(from), to: Number(to), time })),
    ),
  };

  validateMetrobookGraph(graph);
  return graph;
};

/** Проверка правдоподобия: вёрстка недокументирована и может измениться в любой момент */
export const validateMetrobookGraph = (g: IMetrobookGraphFile): void => {
  const instances = Object.keys(g.stationInstances).length;
  const edges = g.edges.length;
  const named = Object.values(g.stations).filter((s) => s.name).length;
  if (instances < 300 || edges < 300 || named < 250) {
    throw new Error(
      `metrobook.ru: извлечённый граф неправдоподобен (вершин ${instances}, перегонов ${edges}, ` +
        `названных станций ${named}) — вёрстка сайта изменилась`,
    );
  }
};

export const fetchMetrobookGraph = async (opts: IMetrobookFetchOpts): Promise<IMetrobookGraphFile> => {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(opts.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} при запросе ${opts.url}`);
  }
  const html = await res.text();
  return parseMetrobookHtml(html, (opts.now?.() ?? new Date()).toISOString(), opts.url);
};

// ─── Нормализация в единый формат ────────────────────────────────────────────

const LINE_KIND_BY_TYPE: Record<number, TLineKind> = { 0: 'metro', 1: 'mcc', 2: 'mcd' };

/**
 * Собирает IMetroDataset из графа metrobook. Заполняется только обязательное ядро:
 * станции с русским названием, линии (без названий), перегоны и пересадки в секундах.
 */
export const normalizeMetrobook = (g: IMetrobookGraphFile): IMetroDataset => {
  const stations: IMetroStation[] = Object.entries(g.stationInstances).map(([sdid, inst]) => {
    const groupName = g.stations[String(inst.stationId)]?.name ?? null;
    return {
      id: Number(sdid),
      name: { ru: inst.name ?? groupName ?? `Станция ${sdid}` },
      lineId: inst.lineId,
    };
  });

  const lines: IMetroLine[] = Object.entries(g.lines).map(([lid, l]) => ({
    id: Number(lid),
    kind: LINE_KIND_BY_TYPE[l.type] ?? 'metro',
  }));

  const edges: IMetroEdge[] = [
    // Перегоны в источнике неориентированные — считаем двусторонними
    ...g.edges.map((e) => ({
      kind: 'ride' as const,
      edgeId: `e${e.id}`,
      fromId: e.sdid1,
      toId: e.sdid2,
      timeSec: e.time,
      bi: true,
      lineId: e.lineId,
    })),
    // Пересадки перечислены в обе стороны отдельными записями — добавляем как односторонние.
    // Значение 999999 — соглашение «переход запрещён», такие записи отбрасываются,
    // иначе алгоритм Дейкстры мог бы выбрать «пересадку» длиной 11 дней.
    ...g.transfers
      .filter((t) => t.time < FORBIDDEN_TRANSFER_SEC)
      .map((t) => ({
        kind: 'transfer' as const,
        edgeId: `tt${t.from}-${t.to}`,
        fromId: t.from,
        toId: t.to,
        timeSec: t.time,
        bi: false,
      })),
  ];

  return {
    source: 'metrobook',
    schemaFetchedAt: g.fetchedAt,
    stations,
    lines,
    edges,
  };
};

// ─── Обогащение из последней сохранённой схемы mosmetro ─────────────────────

const normName = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/**
 * Подтягивает в набор metrobook сведения из схемы mosmetro (пусть даже устаревшей):
 *  1) многоязычные названия станций (en/ar/cn) — по совпадению русского названия;
 *  2) «вторые» имена пересадочных узлов как searchAliases: у metrobook узел
 *     «Пушкинская — Тверская — Чеховская» подписан только «Пушкинская», и без псевдонимов
 *     поиск «Тверская» ничего бы не нашёл.
 * Возвращает новый dataset, исходный не изменяется.
 */
export const enrichMetrobookFromMosmetroSchema = (
  dataset: IMetroDataset,
  schemaRaw: IMosmetroRawSchema,
): IMetroDataset => {
  const { data } = schemaRaw;

  // Многоязычные названия по русскому имени
  const namesByRu = new Map<string, ILocalizedName>();
  for (const s of data.stations) {
    const ru = s.name?.ru;
    if (!ru) {
      continue;
    }
    const key = normName(ru);
    const existing = namesByRu.get(key);
    namesByRu.set(key, {
      ru,
      ...(s.name?.en ? { en: s.name.en } : existing?.en ? { en: existing.en } : {}),
      ...(s.name?.ar ? { ar: s.name.ar } : existing?.ar ? { ar: existing.ar } : {}),
      ...(s.name?.cn ? { cn: s.name.cn } : existing?.cn ? { cn: existing.cn } : {}),
    });
  }

  // Пересадочные узлы mosmetro: объединение станций, связанных переходами (система непересекающихся множеств)
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) {
      r = parent.get(r)!;
    }
    parent.set(x, r);
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
    }
  };
  for (const s of data.stations) {
    parent.set(s.id, s.id);
  }
  for (const t of data.transitions) {
    union(t.stationFromId, t.stationToId);
  }

  // Для каждого узла — множество названий его станций; индекс «название → все названия узла»
  const nodeNames = new Map<number, Set<string>>();
  for (const s of data.stations) {
    const root = find(s.id);
    const set = nodeNames.get(root) ?? new Set<string>();
    if (s.name?.ru) {
      set.add(s.name.ru);
    }
    nodeNames.set(root, set);
  }
  const aliasesByName = new Map<string, Set<string>>();
  for (const set of nodeNames.values()) {
    if (set.size < 2) {
      continue;
    }
    for (const name of set) {
      const key = normName(name);
      const aliases = aliasesByName.get(key) ?? new Set<string>();
      for (const other of set) {
        if (normName(other) !== key) {
          aliases.add(other);
        }
      }
      aliasesByName.set(key, aliases);
    }
  }

  const stations: IMetroStation[] = dataset.stations.map((st) => {
    const key = normName(st.name.ru);
    const localized = namesByRu.get(key);
    const aliasSet = aliasesByName.get(key);
    const aliases = [...new Set([...(st.searchAliases ?? []), ...(aliasSet ?? [])])];
    return {
      ...st,
      name: {
        ...st.name,
        ...(localized?.en && !st.name.en ? { en: localized.en } : {}),
        ...(localized?.ar && !st.name.ar ? { ar: localized.ar } : {}),
        ...(localized?.cn && !st.name.cn ? { cn: localized.cn } : {}),
      },
      ...(aliases.length ? { searchAliases: aliases } : {}),
    };
  });

  return { ...dataset, stations };
};
