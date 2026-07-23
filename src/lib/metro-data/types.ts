// Unified normalized metro data format (IMetroDataset).
//
// The format is the same for both sources. The rich source (mosmetro.ru) fills all fields,
// the reduced one (metrobook.ru) — only the mandatory core: stations with a Russian name,
// lines, edges with time in seconds. All routing and search code is written against this
// type: a missing optional field just means less information in the response, without any
// per-source branching.

/** The source the dataset was obtained from */
export type TMetroSource = 'mosmetro' | 'metrobook';

/** Line kind: regular metro, Moscow Central Circle, Moscow Central Diameters */
export type TLineKind = 'metro' | 'mcc' | 'mcd';

/** Name in supported languages. The Russian name is mandatory, the rest depend on the source */
export interface ILocalizedName {
  ru: string;
  en?: string;
  ar?: string;
  cn?: string;
}

export interface IGeoPoint {
  lat: number;
  lon: number;
}

/** Station exit to the city with nearby surface transport routes */
export interface IStationExit {
  title?: string;
  exitNumber?: number;
  location?: IGeoPoint;
  /** Route numbers separated by commas, as provided by the source (e.g. "270, м40") */
  bus?: string;
  trolleybus?: string;
  tram?: string;
}

/** First/last train towards stationToId (train intervals are not in the open data) */
export interface ITrainScheduleEntry {
  stationToId: number;
  stationToName?: string;
  first?: string;
  last?: string;
  /** EVEN/ODD — even/odd days of the month: trains run on two alternating timetables */
  dayType?: string;
  /** true — weekend timetable, false — weekday */
  weekend?: boolean;
}

/** Station vestibule opening hours for one day of the week ("05:30" — "01:00") */
export interface IStationWorkTimeDay {
  open?: string;
  close?: string;
}

export interface IMetroStation {
  /** Graph vertex identifier: a station of a specific line (a transfer hub is several stations) */
  id: number;
  name: ILocalizedName;
  lineId: number;
  /** Time in seconds from street entrance to the platform (absent for MCD stations in the data) */
  enterTimeSec?: number;
  /** Time in seconds from the platform to the city exit */
  exitTimeSec?: number;
  location?: IGeoPoint;
  exits?: IStationExit[];
  /** Station services: BANK, ELEVATOR, VENDING, etc. */
  services?: string[];
  /** Timetable of first/last trains by direction (key — direction id in the source) */
  scheduleTrains?: Record<string, ITrainScheduleEntry[]>;
  /** Vestibule opening hours by day of week: 7 entries, Monday — Sunday (mosmetro only) */
  workTime?: IStationWorkTimeDay[];
  /** Under-construction (prospective) station — not yet open (none in current data, future-proof field) */
  isPerspective?: boolean;
  /** Surface station (platform not underground) */
  isOutside?: boolean;
  /** Tactile station map for the blind — link to an HTML page */
  typhloHtmlUrl?: string;
  /** Station map images — links to images (PNG/JPG) */
  schemeImageUrls?: string[];
  /** Audio files describing the station (navigation for the blind) — links to WAV */
  audioUrls?: string[];
  /** Historical note about the station (always empty in current source data, future-proof field) */
  history?: string;
  /**
   * Additional names for fuzzy search. Used when running on metrobook data:
   * a transfer hub there has a single label ("Pushkinskaya"), and the hub's "secondary"
   * names ("Tverskaya", "Chekhovskaya") are pulled in here from the last saved mosmetro schema.
   */
  searchAliases?: string[];
}

export interface IMetroLine {
  id: number;
  /** Metrobook has no line names — the field is optional */
  name?: ILocalizedName;
  color?: string;
  kind: TLineKind;
  /**
   * Display ordering from the mosmetro API — matches the public line number for regular
   * metro lines (1..15). Exceptions are handled by consumers (80 = «8А», 75 = «16»);
   * MCD/MCC display labels are derived from the line name/kind instead. Absent for metrobook.
   */
  ordering?: number;
}

/** Recommendation which wagon to board for the most convenient exit to a transfer */
export interface IWagonHint {
  stationToId?: number;
  stationPrevId?: number;
  /** NEAR_FIRST — closer to the head, NEAR_END — closer to the tail, CENTER — in the middle */
  types: string[];
}

export interface IMetroEdge {
  /** ride — trip between adjacent stations; transfer — walking transfer inside a hub */
  kind: 'ride' | 'transfer';
  /** Unique edge key within the dataset (needed for applying closures and Yen's algorithm) */
  edgeId: string;
  fromId: number;
  toId: number;
  /** Time in seconds (in the mosmetro source the field is called pathLength but holds seconds) */
  timeSec: number;
  /** Whether the edge is bidirectional */
  bi: boolean;
  /** Line (kind='ride' only) */
  lineId?: number;
  /** Street-level transfer (kind='transfer' only) */
  isGround?: boolean;
  /** Wagon recommendations (kind='transfer' only, mosmetro only) */
  wagons?: IWagonHint[];
  /** Temporary detour edge from a closure notification */
  isAlternative?: boolean;
}

export type TNotificationStatus = 'CLOSED' | 'EMERGENCY' | 'INFO';

export interface INotificationStationRef {
  stationId: number;
  status: TNotificationStatus;
  title?: string;
  description?: string;
}

/** Closure/repair notification effective within the startDate..endDate period */
export interface IMetroNotification {
  id: number | string;
  title?: string;
  description?: string;
  /** ISO strings in local time, as provided by the API */
  startDate: string;
  endDate: string;
  stations: INotificationStationRef[];
  /** edgeId of closed ride segments and transfers (remove from the graph for the period) */
  closedEdgeIds: string[];
  /** Temporary detour edges (add to the graph for the period) */
  alternativeEdges: IMetroEdge[];
}

export interface IMetroDataset {
  source: TMetroSource;
  /** When the schema was downloaded (ISO UTC) */
  schemaFetchedAt: string;
  /** When notifications were downloaded; absent if there are none (metrobook or mosmetro without them) */
  notificationsFetchedAt?: string;
  stations: IMetroStation[];
  lines: IMetroLine[];
  edges: IMetroEdge[];
  /** Closures and repairs. Mosmetro only; the file's time-to-live is 24 hours */
  notifications?: IMetroNotification[];
}

/** Normalized metrobook.ru graph — the format of the metrobook-graph.json file on disk */
export interface IMetrobookGraphFile {
  source: string;
  fetchedAt: string;
  mapId: number;
  /** lineId -> { type: 0 metro | 1 MCC | 2 MCD } */
  lines: Record<string, { type: number }>;
  /** sdid ("station on a line") -> graph vertex */
  stationInstances: Record<string, { stationId: number; lineId: number; name: string | null }>;
  /** sid (physical station) -> group of vertices */
  stations: Record<string, { sdids: number[]; name: string | null }>;
  /** Ride segments, time — seconds */
  edges: Array<{ id: number; sdid1: number; sdid2: number; lineId: number; time: number }>;
  /** Transfers, time — seconds; 999999 means "transfer forbidden" and is dropped */
  transfers: Array<{ from: number; to: number; time: number }>;
}
