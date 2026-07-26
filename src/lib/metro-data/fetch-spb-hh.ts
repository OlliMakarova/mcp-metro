// Download of the Saint Petersburg metro reference from the public HeadHunter API.
//
// GET https://api.hh.ru/metro/2 returns a documented JSON reference of the city's metro:
// lines with Russian names, HEX colors and an ordered station list; every station carries
// coordinates. This source has no travel/transfer times — the weighted graph comes from the
// SPb metrobook mirror — so it is used purely for enrichment: coordinates, line names/colors,
// station ordering, and as the topology source for lines still missing from the graph source
// (line 6 «Красносельско-Калининская» at the time of writing).

/** Station entry of the hh.ru metro reference */
export interface ISpbHhStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Position of the station on its line, 0-based, in track order */
  order: number;
}

/** Line entry of the hh.ru metro reference */
export interface ISpbHhLine {
  id: string;
  /** HEX color without the leading # */
  hex_color: string;
  name: string;
  stations: ISpbHhStation[];
}

/** The hh.ru metro reference file for one city, as stored on disk */
export interface ISpbHhMetroFile {
  fetchedAt: string;
  id: string;
  name: string;
  lines: ISpbHhLine[];
}

export interface ISpbHhFetchOpts {
  url: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** Plausibility check of the reference: SPb has 5+ lines and 70+ stations */
export const validateSpbHhMetro = (raw: unknown): ISpbHhMetroFile => {
  const data = raw as ISpbHhMetroFile;
  if (!data || !Array.isArray(data.lines)) {
    throw new Error('hh.ru metro reference: unexpected response shape (no lines array)');
  }
  const stations = data.lines.flatMap((l) => l.stations ?? []);
  const named = stations.filter((s) => s && typeof s.name === 'string' && s.name.trim()).length;
  const located = stations.filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lng)).length;
  if (data.lines.length < 5 || named < 60 || located < 60) {
    throw new Error(
      `hh.ru metro reference is implausible (${data.lines.length} lines, ${named} named, ${located} located stations)`,
    );
  }
  return data;
};

export const fetchSpbHhMetro = async (opts: ISpbHhFetchOpts): Promise<ISpbHhMetroFile> => {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(opts.url, {
    headers: { 'User-Agent': 'mcp-metro/1.0' },
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} while requesting ${opts.url}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  const validated = validateSpbHhMetro(raw);
  return { ...validated, fetchedAt: (opts.now?.() ?? new Date()).toISOString() };
};
