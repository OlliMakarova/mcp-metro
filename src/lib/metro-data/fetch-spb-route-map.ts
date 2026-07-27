// Download and parsing of the official interactive route calculator of the Saint Petersburg
// metro — https://metro.spb.ru/map1/route.html (the «interactive map» page interactive.html is
// just a wrapper around it and carries no data).
//
// The calculator is fully client-side; there is no server API. Everything lives in two static
// files (see the research in data/spb/metro-spb-ru/README.md):
//   map1/files/spb00000.js — the model: subwayOptions (timing constants) and subwayData
//     (6 lines with per-station codes and x/y coordinates IN PIXELS of the map image, the
//     transfer list, and the close/open/obstacles containers for temporary changes);
//   map1/route.html        — station titles: an alphabetical <li> list plus a parallel array
//     of station codes in the inline stationsList.init([...]) call. Stations closed for
//     reconstruction are commented out in both (while remaining in the graph model).
//
// Ride times are NOT stored — the site derives them from map geometry:
//   time = round(distancePx / speed(distancePx)) + stopTime,
//   speed = trainSpeed[round(distancePx / 10)] px/s (the last array value beyond it).
// This module reproduces the formula and stores ready-made per-segment times, so the file on
// disk is a self-sufficient weighted graph. It backs four features:
//   1) a fallback graph core for the SPb dataset when the primary graph source is down;
//   2) machine-readable closed-station detection (the commented-out picker entries);
//   3) realistic transfer times (walk 150–240 s + half train interval) for the whole dataset;
//   4) street-entrance/exit times (entranceMin/Max) for door-to-door estimates.

import { httpsGetTextPinnedRussianCa } from './spb-official-tls.js';
import { IMetrobookGraphFile } from './types.js';

/** The calculator's three-letter line codes mapped to public SPb line numbers. The site files
 * carry no line names or numbers (codes only differ by color in CSS); the mapping is fixed
 * here and confirmed by station composition against the other SPb sources. */
const LINE_ID_BY_CODE: Record<string, number> = { kiv: 1, mop: 2, nev: 3, prb: 4, frp: 5, kra: 6 };

export interface ISpbRouteMapStation {
  /** Calculator station code, e.g. «kiv-dev» */
  code: string;
  /** Russian title from the page markup; null when the markup carries none */
  title: string | null;
  /** Coordinates in pixels of the calculator's map image (NOT geographic) */
  x: number;
  y: number;
}

export interface ISpbRouteMapLine {
  /** Calculator line code, e.g. «kiv» */
  code: string;
  /** Public line number (1..6); null for an unknown future code */
  lineId: number | null;
  /** Stations in track order */
  stations: ISpbRouteMapStation[];
}

/** Timing constants derived from the calculator's subwayOptions, seconds */
export interface ISpbRouteMapTiming {
  /** Stop at a station, included in every ride segment */
  rideStopSec: number;
  /** Per-segment ride uncertainty */
  rideFaultSec: number;
  /** Transfer between lines: mean walking time plus half the train interval */
  transferSec: number;
  transferFaultSec: number;
  /** Street entrance to the platform, lower/upper bound */
  entranceMinSec: number;
  entranceMaxSec: number;
}

/** Parsed calculator model, as stored on disk (spb-route-map.json) */
export interface ISpbRouteMapFile {
  fetchedAt: string;
  pageUrl: string;
  dataUrl: string;
  timing: ISpbRouteMapTiming;
  lines: ISpbRouteMapLine[];
  /** Ride segments with times computed by the site's own distance formula */
  edges: Array<{ from: string; to: string; rideSec: number }>;
  /** Transfer pairs as station codes; the source lists every pair in both directions */
  transfers: Array<{ s1: string; s2: string }>;
  /** Stations commented out of the picker — closed for reconstruction */
  closedStations: Array<{ code: string; title: string | null }>;
  /** Closed transfers («s1-code s2-code» → reason/until), when the site announces them */
  obstacles: Record<string, { reason?: string; until?: string }>;
}

export interface ISpbRouteMapFetchOpts {
  pageUrl: string;
  dataUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface ISubwayOptionsRaw {
  entranceMin: number;
  entranceMax: number;
  transferMin: number;
  transferMax: number;
  trainLatency: number;
  trainSpeed: number[];
  stageFault: number;
  stopTime: number;
}

interface ISubwayDataRaw {
  lines: Record<string, Array<{ id: string; x: number; y: number }>>;
  transfers: Array<{ s1: string; s2: string }>;
  obstacles?: Record<string, { reason?: string; until?: string }>;
}

/**
 * Extracts the calculator model from the two downloaded files. Throws a clear error when the
 * structure no longer matches (the mini-app is for humans and may change with a map update).
 */
export const parseSpbRouteMap = (
  pageHtml: string,
  dataJs: string,
  fetchedAt: string,
  pageUrl: string,
  dataUrl: string,
): ISpbRouteMapFile => {
  // Run the data file in an isolated context: it only declares subwayOptions/subwayData.
  // The same technique as the primary graph source parser (see parseMetrobookHtml).
  const sandbox: { subwayOptions?: ISubwayOptionsRaw; subwayData?: ISubwayDataRaw } = {};
  // eslint-disable-next-line no-new-func
  new Function(`${dataJs}\n;this.subwayOptions = subwayOptions; this.subwayData = subwayData;`).call(sandbox);
  const options = sandbox.subwayOptions;
  const data = sandbox.subwayData;
  if (!options?.trainSpeed?.length || !data?.lines || !data.transfers) {
    throw new Error('metro.spb.ru/map1: subwayOptions/subwayData not found — the data file structure has changed');
  }

  // Station titles: the order of active <li> items matches the order of codes in the
  // stationsList.init([...]) array; commented-out (closed) entries pair up by appearance order
  const itemsBlock = pageHtml.match(/<ul class="items">([\s\S]*?)<\/ul>/)?.[1];
  const initArr = pageHtml.match(/stationsList\.init\(\[([\s\S]*?)\]\)/)?.[1];
  if (!itemsBlock || !initArr) {
    throw new Error('metro.spb.ru/map1: station list or code array not found — the page markup has changed');
  }
  const liRe = /<li>([^<]+)<\/li>/g;
  const activeTitles = [...itemsBlock.replace(/<!--[\s\S]*?-->/g, '').matchAll(liRe)].map((m) => m[1]!.trim());
  const commentedTitles = [...itemsBlock.matchAll(/<!--\s*<li>([^<]+)<\/li>\s*-->/g)].map((m) => m[1]!.trim());
  const codeRe = /"([a-z]{3}-[a-z]{3})"/g;
  const activeCodes = [...initArr.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(codeRe)].map((m) => m[1]!);
  const commentedCodes = [...initArr.matchAll(/\/\*\s*"([a-z]{3}-[a-z]{3})"\s*,?\s*\*\//g)].map((m) => m[1]!);
  if (activeCodes.length !== activeTitles.length) {
    throw new Error(
      `metro.spb.ru/map1: station list does not match the code array (${activeTitles.length} titles, ${activeCodes.length} codes)`,
    );
  }
  const titleByCode = new Map<string, string>(activeCodes.map((code, i) => [code, activeTitles[i]!]));
  commentedCodes.forEach((code, i) => {
    const title = commentedTitles[i];
    if (title) {
      titleByCode.set(code, title);
    }
  });

  // The site's ride-time formula: pixel distance over an empirical speed ramp plus a stop
  const speedAt = (distance: number): number => {
    const n = Math.round(distance / 10);
    return options.trainSpeed[n] ?? options.trainSpeed[options.trainSpeed.length - 1]!;
  };
  const rideSec = (a: ISpbRouteMapStation, b: ISpbRouteMapStation): number => {
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.round(distance / speedAt(distance) + options.stopTime);
  };

  const lines: ISpbRouteMapLine[] = Object.entries(data.lines).map(([code, items]) => ({
    code,
    lineId: LINE_ID_BY_CODE[code] ?? null,
    stations: items.map((s) => ({
      code: `${code}-${s.id}`,
      title: titleByCode.get(`${code}-${s.id}`) ?? null,
      x: s.x,
      y: s.y,
    })),
  }));
  const edges: ISpbRouteMapFile['edges'] = [];
  for (const line of lines) {
    for (let i = 0; i + 1 < line.stations.length; i++) {
      const a = line.stations[i]!;
      const b = line.stations[i + 1]!;
      edges.push({ from: a.code, to: b.code, rideSec: rideSec(a, b) });
    }
  }

  const halfLatency = Math.round(options.trainLatency / 2);
  const file: ISpbRouteMapFile = {
    fetchedAt,
    pageUrl,
    dataUrl,
    timing: {
      rideStopSec: options.stopTime,
      rideFaultSec: options.stageFault,
      transferSec: Math.round((options.transferMax + options.transferMin) / 2) + halfLatency,
      transferFaultSec: Math.round((options.transferMax - options.transferMin) / 2) + halfLatency,
      entranceMinSec: options.entranceMin,
      entranceMaxSec: options.entranceMax,
    },
    lines,
    edges,
    transfers: data.transfers.map((t) => ({ s1: t.s1, s2: t.s2 })),
    closedStations: commentedCodes.map((code) => ({ code, title: titleByCode.get(code) ?? null })),
    obstacles: data.obstacles ?? {},
  };
  validateSpbRouteMap(file);
  return file;
};

/** Plausibility check: the SPb network has 6 lines, 70+ stations, 60+ segments, 16+ transfers */
export const validateSpbRouteMap = (f: ISpbRouteMapFile): void => {
  const stationCount = f.lines.reduce((n, l) => n + l.stations.length, 0);
  const titledCount = f.lines.reduce((n, l) => n + l.stations.filter((s) => s.title).length, 0);
  const bad =
    f.lines.length < 5 ||
    stationCount < 70 ||
    titledCount < 70 ||
    f.edges.length < 60 ||
    f.transfers.length < 16 ||
    !(f.timing.transferSec > 0) ||
    !(f.timing.entranceMinSec > 0);
  if (bad) {
    throw new Error(
      `metro.spb.ru/map1: extracted model is implausible (${f.lines.length} lines, ${stationCount} stations, ${titledCount} titled, ${f.edges.length} edges, ${f.transfers.length} transfers) — the calculator structure has changed`,
    );
  }
};

export const fetchSpbRouteMap = async (opts: ISpbRouteMapFetchOpts): Promise<ISpbRouteMapFile> => {
  const get = async (url: string): Promise<string> => {
    if (opts.fetchImpl) {
      // Test path: the injected fetch substitute
      const res = await opts.fetchImpl(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: '*/*' },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} while requesting ${url}`);
      }
      return res.text();
    }
    // Production path: pinned Russian Trusted Root CA, mandatory Accept (the /map1/* WAF)
    return httpsGetTextPinnedRussianCa(url, opts.timeoutMs);
  };
  const pageHtml = await get(opts.pageUrl);
  const dataJs = await get(opts.dataUrl);
  return parseSpbRouteMap(pageHtml, dataJs, (opts.now?.() ?? new Date()).toISOString(), opts.pageUrl, opts.dataUrl);
};

// ─── Fallback graph core ─────────────────────────────────────────────────────

const normTitle = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/**
 * Converts the calculator model into the metrobook graph-file format, so the whole existing
 * SPb assembly pipeline (normalization, enrichment, routing) runs unchanged when the primary
 * graph source is unavailable. Vertex ids are synthetic but stable: lineId*1000 + track index.
 */
export const routeMapToMetrobookGraph = (map: ISpbRouteMapFile): IMetrobookGraphFile => {
  const sdidByCode = new Map<string, number>();
  const stationInstances: IMetrobookGraphFile['stationInstances'] = {};
  const stations: IMetrobookGraphFile['stations'] = {};
  const sidByTitle = new Map<string, number>();
  const lines: IMetrobookGraphFile['lines'] = {};
  let nextSid = 1;

  for (const line of map.lines) {
    if (line.lineId === null) {
      continue;
    }
    lines[String(line.lineId)] = { type: 0 };
    line.stations.forEach((s, i) => {
      const sdid = line.lineId! * 1000 + i;
      sdidByCode.set(s.code, sdid);
      // Physical stations are grouped by title; the calculator names hub sides differently
      // («Технологический институт 1»/«2»), which matches the primary source's behaviour
      const titleKey = normTitle(s.title ?? s.code);
      const sid = sidByTitle.get(titleKey) ?? nextSid++;
      sidByTitle.set(titleKey, sid);
      stationInstances[String(sdid)] = { stationId: sid, lineId: line.lineId!, name: s.title };
      const group = stations[String(sid)] ?? { sdids: [], name: s.title };
      group.sdids.push(sdid);
      stations[String(sid)] = group;
    });
  }

  const edges: IMetrobookGraphFile['edges'] = [];
  for (const e of map.edges) {
    const sdid1 = sdidByCode.get(e.from);
    const sdid2 = sdidByCode.get(e.to);
    if (sdid1 === undefined || sdid2 === undefined) {
      continue;
    }
    const { lineId } = stationInstances[String(sdid1)]!;
    edges.push({ id: edges.length + 1, sdid1, sdid2, lineId, time: e.rideSec });
  }

  const transfers: IMetrobookGraphFile['transfers'] = [];
  for (const t of map.transfers) {
    const from = sdidByCode.get(t.s1);
    const to = sdidByCode.get(t.s2);
    if (from !== undefined && to !== undefined) {
      transfers.push({ from, to, time: map.timing.transferSec });
    }
  }

  return {
    source: map.pageUrl,
    fetchedAt: map.fetchedAt,
    mapId: 0,
    lines,
    stationInstances,
    stations,
    edges,
    transfers,
  };
};
