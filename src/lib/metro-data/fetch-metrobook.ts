// Download and normalization of the backup data source — metrobook.ru.
//
// The entire weighted metro graph is embedded right in the HTML of the main page (a single GET /):
//   mb.arrSD[sdid] = {sid, lid}          — "station on a line" (graph vertex)
//   mb.arrS[sid]   = {sdids: [...]}      — physical station = group of vertices
//   mb.arrR[rid]   = {ttime, sdid1, sdid2, lid} — ride segment, ttime in seconds
//   mb.arrTT[a][b] = seconds             — transfer; 999999 means "transfer forbidden"
//   mb.arrL[lid]   = {type}              — line: 0 metro, 1 MCC, 2 MCD
// Station names live in the markup: <span mb_sd_id='NN' class='stName ...'>Name</span>.
//
// Source limitations (see data/metrobook-ru/README.md): Russian-only names, a transfer hub
// has a single label, no closures/wagons/coordinates/enter-exit times, one-minute time
// precision. Some of these gaps are covered by enrichMetrobookFromMosmetroSchema().

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

/** Convention value "transfer forbidden" in the metrobook transfer table */
const FORBIDDEN_TRANSFER_SEC = 999_999;

// ─── Download and HTML parsing ───────────────────────────────────────────────

export interface IMetrobookFetchOpts {
  url: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Plausibility floor for the extracted graph; defaults to the Moscow network size */
  limits?: IMetrobookGraphLimits;
}

/** Minimal plausible graph size — protects against silently broken markup */
export interface IMetrobookGraphLimits {
  minInstances: number;
  minEdges: number;
  minNamed: number;
}

/** Moscow network floor (metro + MCC + MCD: ~380 vertices) */
export const MOSCOW_GRAPH_LIMITS: IMetrobookGraphLimits = { minInstances: 300, minEdges: 300, minNamed: 250 };

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
 * Extracts the graph from the main page HTML. Throws a clear error if the markup has changed.
 * The result format is compatible with the metrobook-graph.json file on disk.
 */
export const parseMetrobookHtml = (
  html: string,
  fetchedAt: string,
  sourceUrl: string,
  limits: IMetrobookGraphLimits = MOSCOW_GRAPH_LIMITS,
): IMetrobookGraphFile => {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
  const dataScript = scripts.find((s) => s.includes('mb.arrSD[') && s.includes('mb.arrR['));
  if (!dataScript) {
    throw new Error('metrobook.ru: inline script with graph data not found — the site markup has changed');
  }

  // Run the inline script in an isolated context: it only populates the mb object.
  // This is the same technique as in the verified research script (data/metrobook-ru/fetch-data.js).
  const mb: IMbRuntime = { arrS: {}, arrSD: {}, arrR: {}, arrTT: [], arrDL: [], arrL: {} };
  // eslint-disable-next-line no-new-func
  new Function('mb', dataScript.replace(/var mb = new Object;[^;]*;/, '')).call(null, mb);

  // Station names from the schema label markup
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
    // The runtime containers may be sparse arrays instead of objects (the SPb mirror) — filter
    // out empty slots before mapping
    lines: Object.fromEntries(
      Object.entries(mb.arrL)
        .filter(([, l]) => !!l)
        .map(([lid, l]) => [lid, { type: l.type }]),
    ),
    stationInstances: Object.fromEntries(
      Object.entries(mb.arrSD)
        .filter(([, sd]) => !!sd)
        .map(([sdid, sd]) => [sdid, { stationId: sd.sid, lineId: sd.lid, name: names[sdid] ?? null }]),
    ),
    stations: Object.fromEntries(
      Object.entries(mb.arrS)
        .filter(([, s]) => !!s?.sdids)
        .map(([sid, s]) => [sid, { sdids: s.sdids, name: s.sdids.map((d) => names[String(d)]).find(Boolean) ?? null }]),
    ),
    edges: Object.entries(mb.arrR)
      .filter(([, r]) => !!r)
      .map(([rid, r]) => ({
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

  validateMetrobookGraph(graph, limits);
  return graph;
};

/** Plausibility check: the markup is undocumented and may change at any moment */
export const validateMetrobookGraph = (
  g: IMetrobookGraphFile,
  limits: IMetrobookGraphLimits = MOSCOW_GRAPH_LIMITS,
): void => {
  const instances = Object.keys(g.stationInstances).length;
  const edges = g.edges.length;
  const named = Object.values(g.stations).filter((s) => s.name).length;
  if (instances < limits.minInstances || edges < limits.minEdges || named < limits.minNamed) {
    throw new Error(
      `metrobook.ru: extracted graph is implausible (${instances} vertices, ${edges} ride segments, ${named} named stations) — the site markup has changed`,
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
    throw new Error(`HTTP ${res.status} ${res.statusText} while requesting ${opts.url}`);
  }
  const html = await res.text();
  return parseMetrobookHtml(html, (opts.now?.() ?? new Date()).toISOString(), opts.url, opts.limits);
};

// ─── Normalization into the unified format ───────────────────────────────────

const LINE_KIND_BY_TYPE: Record<number, TLineKind> = { 0: 'metro', 1: 'mcc', 2: 'mcd' };

/**
 * Builds an IMetroDataset from the metrobook graph. Only the mandatory core is filled:
 * stations with a Russian name, lines (without names), ride segments and transfers in seconds.
 */
export const normalizeMetrobook = (g: IMetrobookGraphFile): IMetroDataset => {
  const stations: IMetroStation[] = Object.entries(g.stationInstances).map(([sdid, inst]) => {
    const ruName = inst.name ?? g.stations[String(inst.stationId)]?.name ?? null;
    return {
      id: Number(sdid),
      // Last-resort placeholder when the source has no name at all: each locale field
      // gets the placeholder in its own language
      name: ruName ? { ru: ruName } : { ru: `Станция ${sdid}`, en: `Station ${sdid}` },
      lineId: inst.lineId,
    };
  });

  const lines: IMetroLine[] = Object.entries(g.lines).map(([lid, l]) => ({
    id: Number(lid),
    kind: LINE_KIND_BY_TYPE[l.type] ?? 'metro',
  }));

  const edges: IMetroEdge[] = [
    // Ride segments in the source are undirected — treat them as bidirectional
    ...g.edges.map((e) => ({
      kind: 'ride' as const,
      edgeId: `e${e.id}`,
      fromId: e.sdid1,
      toId: e.sdid2,
      timeSec: e.time,
      bi: true,
      lineId: e.lineId,
    })),
    // Transfers are listed in both directions as separate records — add them as one-way.
    // The value 999999 is the "transfer forbidden" convention; such records are dropped,
    // otherwise Dijkstra's algorithm could pick a "transfer" lasting 11 days.
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
    city: 'moscow',
    source: 'metrobook',
    schemaFetchedAt: g.fetchedAt,
    stations,
    lines,
    edges,
  };
};

// ─── Enrichment from the last saved mosmetro schema ─────────────────────────

const normName = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/**
 * Pulls information from the mosmetro schema (even a stale one) into the metrobook dataset:
 *  1) multilingual station names (en/ar/cn) — matched by the Russian name;
 *  2) "secondary" names of transfer hubs as searchAliases: in metrobook the hub
 *     "Pushkinskaya — Tverskaya — Chekhovskaya" is labeled only "Pushkinskaya", and without
 *     aliases a search for "Tverskaya" would find nothing.
 * Returns a new dataset; the original is not mutated.
 */
export const enrichMetrobookFromMosmetroSchema = (
  dataset: IMetroDataset,
  schemaRaw: IMosmetroRawSchema,
): IMetroDataset => {
  const { data } = schemaRaw;

  // Multilingual names keyed by the Russian name
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

  // Mosmetro transfer hubs: union of stations connected by transitions (disjoint-set union)
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

  // For each hub — the set of names of its stations; index "name → all names of the hub"
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
