// Rendering of mos_metro_info tool responses as markdown (lists and tables).
//
// All responses the agent sees are formatted as human-readable English markdown: routes and
// station details as tables and numbered lists, clarification requests as an option list.
// Station and line names are given in the requested response language (`lang`) when the data
// provides them. Structured data arrives ready-made from the library layer (src/lib).

import { pickName, TLang } from '../../lib/metro-data/localized-name.js';
import { IStationWorkTimeDay, IWagonHint } from '../../lib/metro-data/types.js';
import {
  IFindRoutesResult,
  ILineInfo,
  IRouteEndpoint,
  IRouteVariant,
  TRouteLeg,
} from '../../lib/routing/find-routes.js';
import { IResolveLineRef, IStationOption, TStationResolution } from '../../lib/station-search/resolve-station.js';
import { IStationInfo, IStationLineRef } from '../../lib/station-info.js';

// ─── Small formatters ────────────────────────────────────────────────────────

/** Seconds to a human-readable duration: «25 min», «1 h 05 min» */
export const fmtDuration = (totalSec: number): string => {
  const min = Math.round(totalSec / 60);
  if (min < 60) {
    return `${min} min`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
};

/** Line kind tag for MCD/MCC lines */
const lineKindTag = (line: { isMcd?: boolean; isMcc?: boolean; kind?: string }): string => {
  const kind = 'kind' in line ? line.kind : undefined;
  if (line.isMcd || kind === 'mcd') {
    return ' (MCD — Moscow Central Diameters)';
  }
  if (line.isMcc || kind === 'mcc') {
    return ' (MCC — Moscow Central Circle)';
  }
  return '';
};

const lineName = (line: ILineInfo | IStationLineRef | IResolveLineRef | undefined, lang: TLang): string => {
  if (!line) {
    return 'unknown line';
  }
  const nm = line.name ? pickName(line.name, lang) : `line #${line.id}`;
  return `${nm}${lineKindTag(line)}`;
};

/** Human-readable car (wagon) recommendations for a transfer */
const wagonAdvice = (wagons: IWagonHint[] | undefined): string | undefined => {
  if (!wagons?.length) {
    return undefined;
  }
  const map: Record<string, string> = {
    NEAR_FIRST: 'front cars (head of the train)',
    NEAR_END: 'rear cars (tail of the train)',
    CENTER: 'middle cars',
  };
  const kinds = new Set<string>();
  for (const w of wagons) {
    for (const t of w.types) {
      kinds.add(map[t] ?? t);
    }
  }
  return kinds.size ? [...kinds].join(' or ') : undefined;
};

/** Station service code labels — translated captions of the mosmetro.ru website dictionary */
const SERVICE_LABELS: Record<string, string> = {
  BANK: 'ATMs',
  INFO: '«Live communication» information desk',
  COFFEE: 'coffee',
  FLOWERS: 'flowers',
  CANDY: 'confectionery',
  CARRIER: 'mobile operator store',
  ELEVATOR: 'elevator',
  BATTERY: 'mobile device charging',
  FOOD: 'food outlets',
  INVALID: 'assistance for passengers with reduced mobility',
  OPTICS: 'optics store',
  PARKING: 'park-and-ride parking',
  PRINT: 'printing services',
  SALES: 'retail kiosks',
  THEATRE: 'theater ticket sales',
  VENDING: 'vending machines',
  TOILET: 'toilet',
  AEROEXPRESS: 'Aeroexpress',
  GIFT_SHOP: 'gift shop',
  // Missing from the website's dictionary; the meaning is confirmed by Deptrans news
  // (transport.mos.ru): service windows of the «Московский транспорт» service centers —
  // travel card replacement, transferring tickets from a faulty «Тройка» card, fare advice
  WINDOW: '«Moscow Transport» service center (travel card service windows)',
};
const serviceLabel = (code: string): string => SERVICE_LABELS[code] ?? code;

const NOTE_STATUS: Record<string, string> = {
  CLOSED: '⛔ closure',
  EMERGENCY: '⚠️ restriction/repair',
  INFO: 'ℹ️ information',
};

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Vestibule working hours in one line: «05:30–01:00 (daily)», and when hours differ
 * by day — with grouping of consecutive identical days: «Mon–Fri 04:38–00:48, Sat–Sun 04:38–01:00».
 */
const workTimeText = (workTime: IStationWorkTimeDay[] | undefined): string | undefined => {
  if (!workTime?.length) {
    return undefined;
  }
  const ranges = workTime.map((w) => (w.open && w.close ? `${w.open}–${w.close}` : undefined));
  if (ranges.some((r) => !r)) {
    return undefined;
  }
  if (new Set(ranges).size === 1) {
    return `${ranges[0]} (daily)`;
  }
  if (ranges.length !== 7) {
    return [...new Set(ranges)].join(', ');
  }
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i <= ranges.length; i++) {
    if (i === ranges.length || ranges[i] !== ranges[start]) {
      const days = start === i - 1 ? WEEK_DAYS[start] : `${WEEK_DAYS[start]}–${WEEK_DAYS[i - 1]}`;
      parts.push(`${days} ${ranges[start]}`);
      start = i;
    }
  }
  return parts.join(', ');
};

// ─── Route rendering ─────────────────────────────────────────────────────────

const renderRideLeg = (leg: Extract<TRouteLeg, { kind: 'ride' }>, index: number, lang: TLang): string => {
  const path = leg.stations.map((s) => pickName(s.name, lang)).join(' → ');
  const stops = leg.stations.length - 1;
  return `${index}. 🚇 **${lineName(leg.line, lang)}** — ${fmtDuration(leg.timeSec)}, stops: ${stops}\n   Stations: ${path}`;
};

const renderTransferLeg = (leg: Extract<TRouteLeg, { kind: 'transfer' }>, index: number, lang: TLang): string => {
  const kind = leg.isGround ? 'street-level transfer' : 'transfer';
  const parts = [
    `${index}. 🔁 **${kind}**: ${pickName(leg.fromStation.name, lang)} → ${pickName(leg.toStation.name, lang)} — ${fmtDuration(leg.timeSec)}`,
  ];
  const advice = wagonAdvice(leg.wagons);
  if (advice) {
    parts.push(`   For a convenient transfer, board the ${advice}.`);
  }
  if (leg.isAlternative) {
    parts.push('   (temporary detour due to a closed section)');
  }
  return parts.join('\n');
};

const renderEndpoint = (role: string, ep: IRouteEndpoint, lang: TLang): string => {
  const lines: string[] = [`**${role}: ${pickName(ep.station.name, lang)}** (${lineName(ep.line, lang)})`];
  if (ep.enterTimeSec !== undefined || ep.exitTimeSec !== undefined) {
    const bits: string[] = [];
    if (ep.enterTimeSec !== undefined) {
      bits.push(`street entrance to platform ~${fmtDuration(ep.enterTimeSec)}`);
    }
    if (ep.exitTimeSec !== undefined) {
      bits.push(`platform to city exit ~${fmtDuration(ep.exitTimeSec)}`);
    }
    lines.push(`- ${bits.join(', ')}`);
  }
  if (ep.groundTransport) {
    const gt = ep.groundTransport;
    const parts: string[] = [];
    if (gt.bus.length) {
      parts.push(`buses: ${gt.bus.join(', ')}`);
    }
    if (gt.trolleybus.length) {
      parts.push(`trolleybuses: ${gt.trolleybus.join(', ')}`);
    }
    if (gt.tram.length) {
      parts.push(`trams: ${gt.tram.join(', ')}`);
    }
    if (parts.length) {
      lines.push(`- Surface transport at the exits: ${parts.join('; ')}`);
    }
  }
  if (ep.services?.length) {
    lines.push(`- Station services: ${ep.services.map(serviceLabel).join(', ')}`);
  }
  return lines.join('\n');
};

const renderVariant = (v: IRouteVariant, n: number, lang: TLang): string => {
  const extraEnter = v.departure.enterTimeSec ?? 0;
  const extraExit = v.arrival.exitTimeSec ?? 0;
  const doorToDoor = v.totalTimeSec + extraEnter + extraExit;

  const out: string[] = [];
  out.push(`## Option ${n} — ${fmtDuration(v.totalTimeSec)} in transit, transfers: ${v.transfersCount}`);
  out.push('');
  out.push(
    `- **Travel time:** ${fmtDuration(v.totalTimeSec)} (on trains ${fmtDuration(v.rideTimeSec)}, on transfers ${fmtDuration(
      v.transferTimeSec,
    )}, expected train wait ~${fmtDuration(v.waitTimeSec)}).`,
  );
  if (extraEnter || extraExit) {
    out.push(
      `- **Including station entry and exit:** ~${fmtDuration(doorToDoor)} (entry ~${fmtDuration(extraEnter)} and exit ~${fmtDuration(extraExit)} extra).`,
    );
  }
  out.push('');
  out.push('**Route legs:**');
  out.push('');
  let i = 1;
  for (const leg of v.legs) {
    out.push(leg.kind === 'ride' ? renderRideLeg(leg, i, lang) : renderTransferLeg(leg, i, lang));
    i += 1;
  }
  out.push('');
  out.push(renderEndpoint('Departure', v.departure, lang));
  out.push('');
  out.push(renderEndpoint('Arrival', v.arrival, lang));
  if (v.warnings.length) {
    out.push('');
    out.push('**Warnings along the route:**');
    for (const w of v.warnings) {
      const status = NOTE_STATUS[w.status] ?? w.status;
      out.push(
        `- ${status} — ${pickName(w.stationName, lang)}: ${w.title ?? ''}${w.description ? ` — ${w.description}` : ''}`,
      );
    }
  }
  return out.join('\n');
};

/** Extra margin (min) on top of the travel time when warning about the upcoming closure */
const ENTRY_CLOSING_SOON_MIN = 30;

/**
 * Warning about the metro operating hours relative to the current Moscow time.
 * The hard deadline is the ENTRY: passengers already inside finish their trip normally
 * (nobody is taken off a train, vestibules keep working for exit after closing). What does
 * close together with the entry are the interline transfer passages — hence the extra note
 * for routes with transfers that end after the closing time.
 */
const operatingWarning = (result: IFindRoutesResult): string | undefined => {
  const op = result.operating;
  if (!op.isOpen) {
    const opensAt = op.opensAt ? ` The entry opens at ${op.opensAt}.` : '';
    return `⛔ **Note: the metro is currently closed.** It is now ${op.moscowTime} Moscow time, and the departure station operates on the ${op.window} schedule.${opensAt} The travel times below are pure trip times and do not include waiting for the metro to open.`;
  }
  if (op.minutesToClose === undefined) {
    return undefined;
  }
  const fastest = result.variants[0];
  const transfersMayClose =
    fastest !== undefined && fastest.transfersCount > 0 && op.minutesToClose < fastest.totalTimeMin;
  if (op.minutesToClose > ENTRY_CLOSING_SOON_MIN && !transfersMayClose) {
    return undefined;
  }
  const parts = [
    `⚠️ **Note: the metro entry closes soon.** It is now ${
      op.moscowTime
    } Moscow time; the entry to the departure station closes in about ${
      op.minutesToClose
    } min (operating hours: ${op.window}) — try to enter before it closes.`,
  ];
  if (transfersMayClose && op.closesAt) {
    parts.push(
      `The route takes about ${fastest.totalTimeMin} min and includes transfers: interline transfer passages close at ${
        op.closesAt
      }, so the transfer at the end of the trip will already be closed — this route cannot be completed. Choose an option without transfers or use surface transport.`,
    );
  }
  return parts.join(' ');
};

/** Full markdown response for the found routes */
export const renderRoutes = (result: IFindRoutesResult, fromName: string, toName: string, lang: TLang): string => {
  const closures = result.closuresApplied ? ' Active closures and repairs are taken into account.' : '';

  const head = [
    `# Routes: ${fromName} → ${toName}`,
    '',
    `Route options found: **${result.variants.length}**.${closures} Travel times include the expected wait for trains at the boarding station and at every transfer, based on typical service intervals for the current time of day.`,
    '',
  ];
  const hasMcd = result.variants.some((v) => v.legs.some((l) => l.kind === 'ride' && l.line?.isMcd));
  if (hasMcd) {
    head.push(
      'ℹ️ Some routes use the MCD: intervals there depend on the specific train and its terminal station, so the actual wait may differ — check the suburban train timetable when possible.',
    );
    head.push('');
  }
  const opWarning = operatingWarning(result);
  if (opWarning) {
    head.push(opWarning);
    head.push('');
  }
  if (!result.variants.length) {
    head.push('No route could be built between the given stations.');
    return head.join('\n');
  }
  const body = result.variants.map((v, idx) => renderVariant(v, idx + 1, lang));
  return [...head, body.join('\n\n')].join('\n');
};

// ─── Station details rendering ───────────────────────────────────────────────

/** Full markdown response with station details */
export const renderStationInfo = (info: IStationInfo, lang: TLang): string => {
  const out: string[] = [];
  const shownName = pickName(info.name, lang);
  out.push(`# Station: ${shownName}`);
  const otherNames = [info.name.ru, info.name.en, info.name.ar, info.name.cn].filter(
    (n): n is string => !!n && n !== shownName,
  );
  if (otherNames.length) {
    out.push('');
    out.push(`Names in other languages: ${otherNames.join(' · ')}`);
  }
  out.push('');
  out.push(`**Station lines:** ${info.lines.map((l) => lineName(l, lang)).join('; ') || '—'}`);
  if (info.location) {
    out.push(`**Station coordinates:** ${info.location.lat}, ${info.location.lon}`);
  }
  if (info.interchanges.length) {
    out.push(`**Transfers to other lines of the hub:** ${info.interchanges.map((l) => lineName(l, lang)).join('; ')}`);
  }

  for (const p of info.platforms) {
    out.push('');
    out.push(`## Platform — ${lineName(p.line, lang)}`);
    const timing: string[] = [];
    if (p.enterTimeSec !== undefined) {
      timing.push(`street entrance to platform ~${fmtDuration(p.enterTimeSec)}`);
    }
    if (p.exitTimeSec !== undefined) {
      timing.push(`platform to city exit ~${fmtDuration(p.exitTimeSec)}`);
    }
    if (timing.length) {
      out.push(`- Walk times: ${timing.join(', ')}.`);
    }
    const workTime = workTimeText(p.workTime);
    if (workTime) {
      out.push(`- Station opening hours: ${workTime}.`);
    }
    if (p.services?.length) {
      out.push(`- Services: ${p.services.map(serviceLabel).join(', ')}.`);
    }
    if (p.exits?.length) {
      out.push('');
      out.push('**Exits to the city:**');
      out.push('');
      out.push('| # | Leads to | Surface transport | Coordinates |');
      out.push('|---|----------|-------------------|-------------|');
      for (const e of p.exits) {
        const transport = [
          e.bus && `bus ${e.bus}`,
          e.trolleybus && `trolleybus ${e.trolleybus}`,
          e.tram && `tram ${e.tram}`,
        ]
          .filter(Boolean)
          .join('; ');
        const coords = e.location ? `${e.location.lat}, ${e.location.lon}` : '—';
        out.push(
          `| ${e.exitNumber ?? '—'} | ${(e.title ?? '—').replace(/\|/g, '/')} | ${transport || '—'} | ${coords} |`,
        );
      }
    }
    if (p.schedule?.length) {
      out.push('');
      out.push('**First and last trains by direction:**');
      out.push('');
      if (p.schedule.some((s) => s.days)) {
        out.push('_«Even»/«odd» refer to dates of the month: trains run on two alternating timetables._');
        out.push('');
      }
      out.push('| Direction | Days | First | Last |');
      out.push('|-----------|------|-------|------|');
      for (const s of p.schedule) {
        const toName = s.toName ? pickName(s.toName, lang) : '—';
        out.push(`| ${toName} | ${s.days ?? 'all days'} | ${s.first ?? '—'} | ${s.last ?? '—'} |`);
      }
    }
  }

  if (info.warnings.length) {
    out.push('');
    out.push('## Warnings (currently active)');
    for (const w of info.warnings) {
      const status = NOTE_STATUS[w.status] ?? w.status;
      out.push(`- ${status} — ${w.title ?? ''}${w.description ? `: ${w.description}` : ''}`);
    }
  }

  return out.join('\n');
};

// ─── Clarification request rendering ─────────────────────────────────────────

const optionLine = (opt: IStationOption, n: number, lang: TLang): string => {
  const lines = opt.lines.map((l) => lineName(l, lang)).join('; ') || 'unknown line';
  return `${n}. **${pickName(opt.name, lang)}** — ${lines}`;
};

/**
 * Clarification block for a single station: an option list (ambiguous) or a request to check
 * the spelling (not_found). `label` is the station role, e.g. «the departure station».
 */
export const renderResolutionAsk = (
  label: string,
  query: string,
  resolution: TStationResolution,
  lang: TLang,
): string => {
  if (resolution.kind === 'not_found') {
    return `### Clarify ${label}: «${query}»
The station name could not be recognized. Check the spelling and specify the station again — Russian, English, Arabic and Chinese are supported.`;
  }
  if (resolution.kind === 'ambiguous') {
    const list = resolution.options.map((o, i) => optionLine(o, i + 1, lang)).join('\n');
    return `### Clarify ${label}: «${query}»
Several matching stations were found. Please pick the right one:
${list}`;
  }
  return '';
};
