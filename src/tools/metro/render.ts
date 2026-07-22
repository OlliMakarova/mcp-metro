// Rendering of mos_metro_info tool responses as markdown (lists and tables).
//
// All responses the agent sees are formatted as human-readable markdown: routes and
// station details as tables and numbered lists, clarification requests as an option
// list. Structured data arrives ready-made from the library layer (src/lib).

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

/** Seconds to a human-readable duration: «25 мин», «1 ч 05 мин» */
export const fmtDuration = (totalSec: number): string => {
  const min = Math.round(totalSec / 60);
  if (min < 60) {
    return `${min} мин`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${h} ч`;
};

/** Line kind tag for MCD/MCC lines */
const lineKindTag = (line: { isMcd?: boolean; isMcc?: boolean; kind?: string }): string => {
  const kind = 'kind' in line ? line.kind : undefined;
  if (line.isMcd || kind === 'mcd') {
    return ' (МЦД — Московские центральные диаметры)';
  }
  if (line.isMcc || kind === 'mcc') {
    return ' (МЦК — Московское центральное кольцо)';
  }
  return '';
};

const lineName = (line: ILineInfo | IStationLineRef | IResolveLineRef | undefined): string => {
  if (!line) {
    return 'линия неизвестна';
  }
  const nm =
    'name' in line && line.name ? (typeof line.name === 'string' ? line.name : line.name.ru) : `линия №${line.id}`;
  return `${nm}${lineKindTag(line)}`;
};

/** Human-readable car (wagon) recommendations for a transfer */
const wagonAdvice = (wagons: IWagonHint[] | undefined): string | undefined => {
  if (!wagons?.length) {
    return undefined;
  }
  const map: Record<string, string> = {
    NEAR_FIRST: 'первые вагоны (голова поезда)',
    NEAR_END: 'последние вагоны (хвост поезда)',
    CENTER: 'средние вагоны',
  };
  const kinds = new Set<string>();
  for (const w of wagons) {
    for (const t of w.types) {
      kinds.add(map[t] ?? t);
    }
  }
  return kinds.size ? [...kinds].join(' или ') : undefined;
};

/** Station service code labels — official captions from the mosmetro.ru website */
const SERVICE_LABELS: Record<string, string> = {
  BANK: 'банкоматы',
  INFO: 'стойка «Живое общение»',
  COFFEE: 'кофе',
  FLOWERS: 'цветы',
  CANDY: 'продажа кондитерских изделий',
  CARRIER: 'салон сотовой связи',
  ELEVATOR: 'лифт на станции',
  BATTERY: 'зарядка для мобильных устройств',
  FOOD: 'общепит',
  INVALID: 'поддержка маломобильных пассажиров',
  OPTICS: 'салон оптики',
  PARKING: 'перехватывающая парковка',
  PRINT: 'печать',
  SALES: 'торговые точки',
  THEATRE: 'продажа билетов в театры',
  VENDING: 'вендинг',
  TOILET: 'туалет',
  AEROEXPRESS: 'аэроэкспресс',
  GIFT_SHOP: 'сувенирный магазин',
  // Missing from the website's dictionary; the meaning is confirmed by Deptrans news
  // (transport.mos.ru): service windows of the «Московский транспорт» service centers —
  // travel card replacement, transferring tickets from a faulty «Тройка» card, fare advice
  WINDOW: 'сервисный центр «Московский транспорт» (окна обслуживания проездных)',
};
const serviceLabel = (code: string): string => SERVICE_LABELS[code] ?? code;

const NOTE_STATUS: Record<string, string> = {
  CLOSED: '⛔ закрытие',
  EMERGENCY: '⚠️ ограничение/ремонт',
  INFO: 'ℹ️ информация',
};

const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Vestibule working hours in one line: «05:30–01:00 (ежедневно)», and when hours differ
 * by day — with grouping of consecutive identical days: «Пн–Пт 04:38–00:48, Сб–Вс 04:38–01:00».
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
    return `${ranges[0]} (ежедневно)`;
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

const renderRideLeg = (leg: Extract<TRouteLeg, { kind: 'ride' }>, index: number): string => {
  const path = leg.stations.map((s) => s.name.ru).join(' → ');
  const stops = leg.stations.length - 1;
  return `${index}. 🚇 **${lineName(leg.line)}** — ${fmtDuration(leg.timeSec)}, перегонов: ${stops}\n   Станции: ${path}`;
};

const renderTransferLeg = (leg: Extract<TRouteLeg, { kind: 'transfer' }>, index: number): string => {
  const kind = leg.isGround ? 'переход по улице' : 'пересадка';
  const parts = [
    `${index}. 🔁 **${kind}**: ${leg.fromStation.name.ru} → ${leg.toStation.name.ru} — ${fmtDuration(leg.timeSec)}`,
  ];
  const advice = wagonAdvice(leg.wagons);
  if (advice) {
    parts.push(`   Для удобной пересадки садитесь в ${advice}.`);
  }
  if (leg.isAlternative) {
    parts.push('   (временный обходной путь из-за закрытия участка)');
  }
  return parts.join('\n');
};

const renderEndpoint = (role: string, ep: IRouteEndpoint): string => {
  const lines: string[] = [`**${role}: ${ep.station.name.ru}** (${lineName(ep.line)})`];
  if (ep.enterTimeSec !== undefined || ep.exitTimeSec !== undefined) {
    const bits: string[] = [];
    if (ep.enterTimeSec !== undefined) {
      bits.push(`вход с улицы до платформы ~${fmtDuration(ep.enterTimeSec)}`);
    }
    if (ep.exitTimeSec !== undefined) {
      bits.push(`платформа до выхода в город ~${fmtDuration(ep.exitTimeSec)}`);
    }
    lines.push(`- ${bits.join(', ')}`);
  }
  if (ep.groundTransport) {
    const gt = ep.groundTransport;
    const parts: string[] = [];
    if (gt.bus.length) {
      parts.push(`автобусы: ${gt.bus.join(', ')}`);
    }
    if (gt.trolleybus.length) {
      parts.push(`троллейбусы: ${gt.trolleybus.join(', ')}`);
    }
    if (gt.tram.length) {
      parts.push(`трамваи: ${gt.tram.join(', ')}`);
    }
    if (parts.length) {
      lines.push(`- Наземный транспорт у выходов: ${parts.join('; ')}`);
    }
  }
  if (ep.services?.length) {
    lines.push(`- Услуги на станции: ${ep.services.map(serviceLabel).join(', ')}`);
  }
  return lines.join('\n');
};

const renderVariant = (v: IRouteVariant, n: number): string => {
  const extraEnter = v.departure.enterTimeSec ?? 0;
  const extraExit = v.arrival.exitTimeSec ?? 0;
  const doorToDoor = v.totalTimeSec + extraEnter + extraExit;

  const out: string[] = [];
  out.push(`## Вариант ${n} — ${fmtDuration(v.totalTimeSec)} в пути, пересадок: ${v.transfersCount}`);
  out.push('');
  out.push(
    `- **Время в пути:** ${fmtDuration(v.totalTimeSec)} (в поездах ${fmtDuration(v.rideTimeSec)}, на переходах ${fmtDuration(v.transferTimeSec)}).`,
  );
  if (extraEnter || extraExit) {
    out.push(
      `- **С учётом входа и выхода:** ~${fmtDuration(doorToDoor)} (дополнительно вход ~${fmtDuration(extraEnter)}, выход ~${fmtDuration(extraExit)}).`,
    );
  }
  out.push('');
  out.push('**Этапы маршрута:**');
  out.push('');
  let i = 1;
  for (const leg of v.legs) {
    out.push(leg.kind === 'ride' ? renderRideLeg(leg, i) : renderTransferLeg(leg, i));
    i += 1;
  }
  out.push('');
  out.push(renderEndpoint('Отправление', v.departure));
  out.push('');
  out.push(renderEndpoint('Прибытие', v.arrival));
  if (v.warnings.length) {
    out.push('');
    out.push('**Предупреждения на маршруте:**');
    for (const w of v.warnings) {
      const status = NOTE_STATUS[w.status] ?? w.status;
      out.push(`- ${status} — ${w.stationName}: ${w.title ?? ''}${w.description ? ` — ${w.description}` : ''}`);
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
    const opensAt = op.opensAt ? ` Вход откроется в ${op.opensAt}.` : '';
    return `⛔ **Внимание: метро сейчас закрыто.** Сейчас ${op.moscowTime} по московскому времени, а станция отправления работает по графику ${op.window}.${opensAt} Указанное ниже время в пути — чистое время поездки, ожидание открытия метро в него не входит.`;
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
    `⚠️ **Внимание: вход в метро скоро закрывается.** Сейчас ${
      op.moscowTime
    } по московскому времени, вход на станцию отправления закроется примерно через ${
      op.minutesToClose
    } мин (график работы: ${op.window}) — постарайтесь войти до закрытия.`,
  ];
  if (transfersMayClose && op.closesAt) {
    parts.push(
      `Маршрут занимает около ${fastest.totalTimeMin} мин и включает пересадки: переходы между линиями закрываются в ${
        op.closesAt
      }, поэтому пересадка в конце поездки будет уже закрыта — доехать этим маршрутом до конца не получится. Выбирайте вариант без пересадок или наземный транспорт.`,
    );
  }
  return parts.join(' ');
};

/** Full markdown response for the found routes */
export const renderRoutes = (result: IFindRoutesResult, fromName: string, toName: string): string => {
  const closures = result.closuresApplied ? 'Учтены действующие закрытия и ремонты.' : '';

  const head = [
    `# Маршруты: ${fromName} → ${toName}`,
    '',
    `Найдено вариантов: **${result.variants.length}**.${closures}`,
    '',
  ];
  const opWarning = operatingWarning(result);
  if (opWarning) {
    head.push(opWarning);
    head.push('');
  }
  if (!result.variants.length) {
    head.push('Не удалось построить ни одного маршрута между указанными станциями.');
    return head.join('\n');
  }
  const body = result.variants.map((v, idx) => renderVariant(v, idx + 1));
  return [...head, body.join('\n\n')].join('\n');
};

// ─── Station details rendering ───────────────────────────────────────────────

/** Full markdown response with station details */
export const renderStationInfo = (info: IStationInfo): string => {
  const out: string[] = [];
  out.push(`# Станция: ${info.name.ru}`);
  const otherNames = [info.name.en, info.name.ar, info.name.cn].filter(Boolean);
  if (otherNames.length) {
    out.push('');
    out.push(`Названия на других языках: ${otherNames.join(' · ')}`);
  }
  out.push('');
  out.push(`**Линии станции:** ${info.lines.map((l) => lineName(l)).join('; ') || '—'}`);
  if (info.location) {
    out.push(`**Координаты станции:** ${info.location.lat}, ${info.location.lon}`);
  }
  if (info.interchanges.length) {
    out.push(`**Пересадки на другие линии узла:** ${info.interchanges.map((l) => lineName(l)).join('; ')}`);
  }

  for (const p of info.platforms) {
    out.push('');
    out.push(`## Платформа — ${lineName(p.line)}`);
    const timing: string[] = [];
    if (p.enterTimeSec !== undefined) {
      timing.push(`вход с улицы до платформы ~${fmtDuration(p.enterTimeSec)}`);
    }
    if (p.exitTimeSec !== undefined) {
      timing.push(`платформа до выхода в город ~${fmtDuration(p.exitTimeSec)}`);
    }
    if (timing.length) {
      out.push(`- Время прохода: ${timing.join(', ')}.`);
    }
    const workTime = workTimeText(p.workTime);
    if (workTime) {
      out.push(`- Режим работы станции: ${workTime}.`);
    }
    if (p.services?.length) {
      out.push(`- Услуги: ${p.services.map(serviceLabel).join(', ')}.`);
    }
    if (p.exits?.length) {
      out.push('');
      out.push('**Выходы в город:**');
      out.push('');
      out.push('| № | Куда ведёт | Наземный транспорт | Координаты |');
      out.push('|---|-----------|--------------------|------------|');
      for (const e of p.exits) {
        const transport = [
          e.bus && `авт. ${e.bus}`,
          e.trolleybus && `трол. ${e.trolleybus}`,
          e.tram && `трам. ${e.tram}`,
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
      out.push('**Первый и последний поезд по направлениям:**');
      out.push('');
      if (p.schedule.some((s) => s.days)) {
        out.push('_«Чётные»/«нечётные» — числа месяца: поезда ходят по двум чередующимся графикам._');
        out.push('');
      }
      out.push('| Направление | Дни | Первый | Последний |');
      out.push('|-------------|-----|--------|-----------|');
      for (const s of p.schedule) {
        out.push(`| ${s.toName ?? '—'} | ${s.days ?? 'все дни'} | ${s.first ?? '—'} | ${s.last ?? '—'} |`);
      }
    }
  }

  if (info.warnings.length) {
    out.push('');
    out.push('## Предупреждения (действуют сейчас)');
    for (const w of info.warnings) {
      const status = NOTE_STATUS[w.status] ?? w.status;
      out.push(`- ${status} — ${w.title ?? ''}${w.description ? `: ${w.description}` : ''}`);
    }
  }

  return out.join('\n');
};

// ─── Clarification request rendering ─────────────────────────────────────────

const optionLine = (opt: IStationOption, n: number): string => {
  const lines = opt.lines.map((l) => lineName(l)).join('; ') || 'линия неизвестна';
  return `${n}. **${opt.name}** — ${lines}`;
};

/**
 * Clarification block for a single station: an option list (ambiguous) or a request to check
 * the spelling (not_found). `label` is the station role, e.g. «станцию отправления».
 */
export const renderResolutionAsk = (label: string, query: string, resolution: TStationResolution): string => {
  if (resolution.kind === 'not_found') {
    return `### Уточните ${label}: «${query}»
Не удалось распознать название станции. Проверьте написание и укажите станцию заново — можно на русском, английском, арабском или китайском языке.`;
  }
  if (resolution.kind === 'ambiguous') {
    const list = resolution.options.map((o, i) => optionLine(o, i + 1)).join('\n');
    return `### Уточните ${label}: «${query}»
Найдено несколько подходящих станций. Пожалуйста, выберите нужную:
${list}`;
  }
  return '';
};
