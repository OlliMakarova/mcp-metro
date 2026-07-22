// Отрисовка ответов инструмента mos_metro_info в markdown (списки и таблицы).
//
// Все ответы, которые видит агент, оформляются человекочитаемым markdown: маршруты и
// сведения о станции — таблицами и нумерованными списками, просьбы об уточнении — списком
// вариантов. Структурные данные приходят из слоя библиотеки (src/lib) уже готовыми.

import {
  IFindRoutesResult,
  ILineInfo,
  IResolveLineRef,
  IRouteEndpoint,
  IRouteVariant,
  IStationInfo,
  IStationLineRef,
  IStationOption,
  IStationWorkTimeDay,
  IWagonHint,
  TStationResolution,
  TRouteLeg,
} from '../../lib/index.js';

// ─── Мелкие форматтеры ───────────────────────────────────────────────────────

/** Секунды в человекочитаемую длительность: «25 мин», «1 ч 05 мин» */
export const fmtDuration = (totalSec: number): string => {
  const min = Math.round(totalSec / 60);
  if (min < 60) {
    return `${min} мин`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${h} ч`;
};

/** Пометка типа линии для МЦД/МЦК */
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

/** Человекочитаемые рекомендации по вагонам на пересадке */
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

/** Расшифровка кодов услуг станции — официальные подписи сайта mosmetro.ru */
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
};
const serviceLabel = (code: string): string => SERVICE_LABELS[code] ?? code;

const NOTE_STATUS: Record<string, string> = {
  CLOSED: '⛔ закрытие',
  EMERGENCY: '⚠️ ограничение/ремонт',
  INFO: 'ℹ️ информация',
};

const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Режим работы вестибюлей одной строкой: «05:30–01:00 (ежедневно)», а при разных часах
 * по дням — с группировкой подряд идущих одинаковых дней: «Пн–Пт 04:38–00:48, Сб–Вс 04:38–01:00».
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

// ─── Отрисовка маршрутов ─────────────────────────────────────────────────────

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

/** Полный markdown-ответ по найденным маршрутам */
export const renderRoutes = (result: IFindRoutesResult, fromName: string, toName: string): string => {
  const sourceName = result.source === 'mosmetro' ? 'mosmetro.ru' : 'metrobook.ru';
  const closures = result.closuresApplied
    ? 'Действующие закрытия и ремонты учтены.'
    : 'Данных о действующих закрытиях нет (учитываются только при свежих данных mosmetro.ru).';

  const head = [
    `# Маршруты: ${fromName} → ${toName}`,
    '',
    `Источник данных: **${sourceName}** (схема от ${result.schemaFetchedAt}). ${closures}`,
    `Найдено вариантов: **${result.variants.length}** (по возрастанию времени в пути).`,
    '',
  ];
  if (!result.variants.length) {
    head.push('Не удалось построить ни одного маршрута между указанными станциями.');
    return head.join('\n');
  }
  const body = result.variants.map((v, idx) => renderVariant(v, idx + 1));
  return [...head, body.join('\n\n')].join('\n');
};

// ─── Отрисовка сведений о станции ────────────────────────────────────────────

/** Полный markdown-ответ со сведениями о станции */
export const renderStationInfo = (info: IStationInfo): string => {
  const sourceName = info.source === 'mosmetro' ? 'mosmetro.ru' : 'metrobook.ru';
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

  out.push('');
  out.push(`_Источник данных: ${sourceName}, схема от ${info.schemaFetchedAt}._`);
  return out.join('\n');
};

// ─── Отрисовка просьбы об уточнении ──────────────────────────────────────────

const optionLine = (opt: IStationOption, n: number): string => {
  const lines = opt.lines.map((l) => lineName(l)).join('; ') || 'линия неизвестна';
  return `${n}. **${opt.name}** — ${lines}`;
};

/**
 * Блок уточнения по одной станции: список вариантов (ambiguous) или просьба проверить
 * написание (not_found). `label` — роль станции, например «станцию отправления».
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
