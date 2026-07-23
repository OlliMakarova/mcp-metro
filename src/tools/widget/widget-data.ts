// Data payload for the MCP Apps route widget (structuredContent of the metro_info tool).
//
// Converts IFindRoutesResult into a compact, fully localized JSON that the widget
// (src/tools/metro/routes-widget.html) renders without any knowledge of the dataset:
// station/line names are already picked for the requested language, wagon hints are
// normalized to front/middle/rear codes, line badges carry the public line number and color.

import { pickName, TLang } from '../../lib/metro-data/localized-name.js';
import { IWagonHint, TLineKind } from '../../lib/metro-data/types.js';
import {
  IFindRoutesResult,
  ILineInfo,
  IRouteEndpoint,
  IRouteVariant,
  TRouteLeg,
} from '../../lib/routing/find-routes.js';
import { endpointWarnings } from '../lib/render.js';

/** Wagon position code understood by the widget's train pictogram */
export type TWagonPos = 'front' | 'middle' | 'rear';

export interface IWidgetLine {
  /** Badge label: public line number («1», «8А», «D2», «14» for MCC); absent — plain color dot */
  badge?: string;
  color?: string;
  name?: string;
  kind: TLineKind;
}

export interface IWidgetRideLeg {
  kind: 'ride';
  line?: IWidgetLine;
  timeSec: number;
  /** All station names of the leg in ride order, including boarding and alighting */
  stations: string[];
}

export interface IWidgetTransferLeg {
  kind: 'transfer';
  from: string;
  to: string;
  timeSec: number;
  isGround: boolean;
  wagons?: TWagonPos[];
  isAlternative?: boolean;
}

export type TWidgetLeg = IWidgetRideLeg | IWidgetTransferLeg;

export interface IWidgetEndpoint {
  name: string;
  line?: IWidgetLine;
  enterTimeSec?: number;
  exitTimeSec?: number;
  buses?: string[];
  trolleybuses?: string[];
  trams?: string[];
}

export interface IWidgetVariant {
  totalTimeSec: number;
  rideTimeSec: number;
  transferTimeSec: number;
  waitTimeSec: number;
  transfersCount: number;
  legs: TWidgetLeg[];
  departure: IWidgetEndpoint;
  arrival: IWidgetEndpoint;
}

export interface IWidgetWarning {
  status: string;
  station: string;
  title?: string;
  description?: string;
}

export interface IRoutesWidgetData {
  widget: 'metro-routes';
  lang: TLang;
  from: string;
  to: string;
  closuresApplied: boolean;
  operating: {
    isOpen: boolean;
    /** Moscow time «HH:MM» the search ran at — the widget derives clock marks from it */
    moscowTime: string;
    window: string;
    minutesToClose?: number;
    closesAt?: string;
    opensAt?: string;
  };
  variants: IWidgetVariant[];
  warnings: IWidgetWarning[];
}

// ─── Line badge ──────────────────────────────────────────────────────────────

/**
 * Display orderings that don't match the public line number: 80 is line «8А»
 * (Солнцевская), 75 is line «16» (Троицкая) in the mosmetro data.
 */
const ORDERING_EXCEPTIONS: Record<number, { ru: string; other: string }> = {
  80: { ru: '8А', other: '8A' },
  75: { ru: '16', other: '16' },
};

/** Public badge label of a line: «1»…«15», «8А», «D1»…«D4A», «14» for the MCC */
const lineBadge = (line: ILineInfo, lang: TLang): string | undefined => {
  if (line.isMcd) {
    // Public MCD numbering is in the name («МЦД-4А» / «MCD-4A»); mosmetro brands it with a latin D
    const m = /МЦД[-\s]?(\d+)(А)?/i.exec(line.name?.ru ?? '') ?? /MCD[-\s]?(\d+)(A)?/i.exec(line.name?.en ?? '');
    return m ? `D${m[1]}${m[2] ? 'A' : ''}` : 'D';
  }
  if (line.isMcc) {
    return '14';
  }
  if (line.ordering === undefined) {
    return undefined;
  }
  const exception = ORDERING_EXCEPTIONS[line.ordering];
  if (exception) {
    return lang === 'ru' ? exception.ru : exception.other;
  }
  return String(line.ordering);
};

const widgetLine = (line: ILineInfo | undefined, lang: TLang): IWidgetLine | undefined => {
  if (!line) {
    return undefined;
  }
  const badge = lineBadge(line, lang);
  const name = line.name ? pickName(line.name, lang) : undefined;
  return {
    ...(badge ? { badge } : {}),
    ...(line.color ? { color: line.color } : {}),
    ...(name ? { name } : {}),
    kind: line.kind,
  };
};

// ─── Wagon hints ─────────────────────────────────────────────────────────────

/** The data uses both NEAR_FIRST/NEAR_END and FIRST/END codes for the same positions */
const WAGON_POS: Record<string, TWagonPos> = {
  NEAR_FIRST: 'front',
  FIRST: 'front',
  CENTER: 'middle',
  NEAR_END: 'rear',
  END: 'rear',
};
const WAGON_ORDER: TWagonPos[] = ['front', 'middle', 'rear'];

/** Normalized car positions in head-to-tail order; undefined when the hint carries no information */
const wagonPositions = (wagons: IWagonHint[] | undefined): TWagonPos[] | undefined => {
  if (!wagons?.length) {
    return undefined;
  }
  const set = new Set<TWagonPos>();
  for (const w of wagons) {
    for (const t of w.types) {
      const pos = WAGON_POS[t];
      if (pos) {
        set.add(pos);
      }
    }
  }
  // «any car works» carries no information — skip the pictogram entirely
  if (!set.size || WAGON_ORDER.every((p) => set.has(p))) {
    return undefined;
  }
  return WAGON_ORDER.filter((p) => set.has(p));
};

// ─── Legs / endpoints / variants ─────────────────────────────────────────────

const widgetLeg = (leg: TRouteLeg, lang: TLang): TWidgetLeg => {
  if (leg.kind === 'ride') {
    return {
      kind: 'ride',
      ...(widgetLine(leg.line, lang) ? { line: widgetLine(leg.line, lang)! } : {}),
      timeSec: leg.timeSec,
      stations: leg.stations.map((s) => pickName(s.name, lang)),
    };
  }
  const wagons = wagonPositions(leg.wagons);
  return {
    kind: 'transfer',
    from: pickName(leg.fromStation.name, lang),
    to: pickName(leg.toStation.name, lang),
    timeSec: leg.timeSec,
    isGround: leg.isGround,
    ...(wagons ? { wagons } : {}),
    ...(leg.isAlternative ? { isAlternative: true } : {}),
  };
};

const widgetEndpoint = (ep: IRouteEndpoint, lang: TLang): IWidgetEndpoint => {
  const line = widgetLine(ep.line, lang);
  const gt = ep.groundTransport;
  return {
    name: pickName(ep.station.name, lang),
    ...(line ? { line } : {}),
    ...(ep.enterTimeSec !== undefined ? { enterTimeSec: ep.enterTimeSec } : {}),
    ...(ep.exitTimeSec !== undefined ? { exitTimeSec: ep.exitTimeSec } : {}),
    ...(gt?.bus.length ? { buses: gt.bus } : {}),
    ...(gt?.trolleybus.length ? { trolleybuses: gt.trolleybus } : {}),
    ...(gt?.tram.length ? { trams: gt.tram } : {}),
  };
};

const widgetVariant = (v: IRouteVariant, lang: TLang): IWidgetVariant => ({
  totalTimeSec: v.totalTimeSec,
  rideTimeSec: v.rideTimeSec,
  transferTimeSec: v.transferTimeSec,
  waitTimeSec: v.waitTimeSec,
  transfersCount: v.transfersCount,
  legs: v.legs.map((leg) => widgetLeg(leg, lang)),
  departure: widgetEndpoint(v.departure, lang),
  arrival: widgetEndpoint(v.arrival, lang),
});

// ─── Public builder ──────────────────────────────────────────────────────────

/** Full widget payload for the found routes (structuredContent of the tool response) */
export const buildRoutesWidgetData = (
  result: IFindRoutesResult,
  fromName: string,
  toName: string,
  lang: TLang,
): IRoutesWidgetData => {
  const op = result.operating;
  const warnings: IWidgetWarning[] = endpointWarnings(result.variants).map((w) => ({
    status: w.status,
    station: pickName(w.stationName, lang),
    ...(w.title ? { title: w.title } : {}),
    ...(w.description ? { description: w.description } : {}),
  }));
  return {
    widget: 'metro-routes',
    lang,
    from: fromName,
    to: toName,
    closuresApplied: result.closuresApplied,
    operating: {
      isOpen: op.isOpen,
      moscowTime: op.moscowTime,
      window: op.window,
      ...(op.minutesToClose !== undefined ? { minutesToClose: op.minutesToClose } : {}),
      ...(op.closesAt ? { closesAt: op.closesAt } : {}),
      ...(op.opensAt ? { opensAt: op.opensAt } : {}),
    },
    variants: result.variants.map((v) => widgetVariant(v, lang)),
    warnings,
  };
};
