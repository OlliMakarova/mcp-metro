// Entry status of the departure hub by Moscow time: whether the vestibules are open
// right now, how long until the entry closes, and when it opens next.
//
// The check is driven by station workTime (vestibule hours by day of week, present in the
// primary source). When no station of the hub has usable hours (the backup source has none),
// the typical Moscow metro entry window 05:30–01:00 is assumed and the status is marked
// approximate. Travel times themselves are not adjusted — the status is informational and
// is rendered as a warning in the route response.

import { IMetroDataset, IStationWorkTimeDay } from '../metro-data/types.js';

const MOSCOW_TZ = 'Europe/Moscow';
const MIN_PER_DAY = 24 * 60;

/** Typical Moscow metro entry window used when the dataset has no vestibule hours */
const DEFAULT_OPEN = '05:30';
const DEFAULT_CLOSE = '01:00';

export interface IOperatingStatus {
  /** Moscow time «HH:MM» the status was computed for */
  moscowTime: string;
  /** true — at least one vestibule of the departure hub is open for entry */
  isOpen: boolean;
  /** The governing working window, e.g. «05:30–01:00» */
  window: string;
  /** Minutes until the entry closes (present when isOpen) */
  minutesToClose?: number;
  /** Time «HH:MM» when the entry (and interline transfers) closes (present when isOpen) */
  closesAt?: string;
  /** Time «HH:MM» when the entry opens next (present when closed) */
  opensAt?: string;
  /** true — no vestibule hours in the data, the typical window 05:30–01:00 was assumed */
  approximate: boolean;
}

/** «HH:MM» → minutes of day, undefined for unparseable values */
const toMin = (hhmm: string | undefined): number | undefined => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!m) {
    return undefined;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : undefined;
};

const fmtMin = (minutesOfDay: number): string => {
  const m = ((minutesOfDay % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Moscow wall-clock parts of the instant: minutes of day and day of week (0 = Monday) */
export const moscowClock = (at: Date): { minutesOfDay: number; weekday: number; hhmm: string } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MOSCOW_TZ,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const minutesOfDay = Number(get('hour')) * 60 + Number(get('minute'));
  return { minutesOfDay, weekday: WEEKDAYS[get('weekday')] ?? 0, hhmm: fmtMin(minutesOfDay) };
};

/** Per-day window in minutes; a window crossing midnight has close <= open (05:30–01:00) */
interface IDayWindow {
  openMin: number;
  closeMin: number;
}

/** workTime is usable only when all 7 days (Monday — Sunday) have parseable open/close */
const parseWeek = (workTime: IStationWorkTimeDay[] | undefined): IDayWindow[] | undefined => {
  if (workTime?.length !== 7) {
    return undefined;
  }
  const week: IDayWindow[] = [];
  for (const w of workTime) {
    const openMin = toMin(w.open);
    const closeMin = toMin(w.close);
    if (openMin === undefined || closeMin === undefined) {
      return undefined;
    }
    week.push({ openMin, closeMin });
  }
  return week;
};

/** Status of a single vestibule week schedule at the given Moscow moment */
interface IWindowStatus {
  isOpen: boolean;
  window: string;
  /** Minutes until close (isOpen) */
  minutesToClose?: number;
  /** Time «HH:MM» of the close (isOpen) */
  closesAt?: string;
  /** Minutes until the next opening (closed) */
  opensInMin?: number;
  opensAt?: string;
}

const evalWeek = (week: IDayWindow[], weekday: number, nowMin: number): IWindowStatus => {
  const today = week[weekday]!;
  const yesterday = week[(weekday + 6) % 7]!;
  const tomorrow = week[(weekday + 1) % 7]!;
  const windowText = (w: IDayWindow): string => `${fmtMin(w.openMin)}–${fmtMin(w.closeMin)}`;

  // Yesterday's window crossing midnight (e.g. 05:30–01:00) still governs the small hours
  if (yesterday.closeMin <= yesterday.openMin && nowMin < yesterday.closeMin) {
    return {
      isOpen: true,
      window: windowText(yesterday),
      minutesToClose: yesterday.closeMin - nowMin,
      closesAt: fmtMin(yesterday.closeMin),
    };
  }
  if (nowMin >= today.openMin) {
    if (today.closeMin <= today.openMin) {
      // Today's window runs past midnight
      return {
        isOpen: true,
        window: windowText(today),
        minutesToClose: today.closeMin + MIN_PER_DAY - nowMin,
        closesAt: fmtMin(today.closeMin),
      };
    }
    if (nowMin < today.closeMin) {
      return {
        isOpen: true,
        window: windowText(today),
        minutesToClose: today.closeMin - nowMin,
        closesAt: fmtMin(today.closeMin),
      };
    }
    return {
      isOpen: false,
      window: windowText(today),
      opensInMin: tomorrow.openMin + MIN_PER_DAY - nowMin,
      opensAt: fmtMin(tomorrow.openMin),
    };
  }
  return {
    isOpen: false,
    window: windowText(today),
    opensInMin: today.openMin - nowMin,
    opensAt: fmtMin(today.openMin),
  };
};

/**
 * Entry status of a station hub (one or more graph vertices) at the moment `at`.
 * Open if at least one vestibule of the hub is open; when closed, `opensAt` is the
 * earliest opening among the hub's vestibules.
 */
export const getOperatingStatus = (dataset: IMetroDataset, stationIds: number[], at: Date): IOperatingStatus => {
  const { minutesOfDay, weekday, hhmm } = moscowClock(at);

  const ids = new Set(stationIds);
  const weeks: IDayWindow[][] = [];
  for (const s of dataset.stations) {
    if (ids.has(s.id)) {
      const week = parseWeek(s.workTime);
      if (week) {
        weeks.push(week);
      }
    }
  }

  const approximate = weeks.length === 0;
  if (approximate) {
    const w: IDayWindow = { openMin: toMin(DEFAULT_OPEN)!, closeMin: toMin(DEFAULT_CLOSE)! };
    weeks.push(Array.from({ length: 7 }, () => w));
  }

  const statuses = weeks.map((week) => evalWeek(week, weekday, minutesOfDay));
  const open = statuses.filter((s) => s.isOpen);
  if (open.length) {
    // The vestibule that stays open the longest governs the hub status
    const best = open.reduce((a, b) => ((a.minutesToClose ?? 0) >= (b.minutesToClose ?? 0) ? a : b));
    return {
      moscowTime: hhmm,
      isOpen: true,
      window: best.window,
      ...(best.minutesToClose !== undefined ? { minutesToClose: best.minutesToClose } : {}),
      ...(best.closesAt ? { closesAt: best.closesAt } : {}),
      approximate,
    };
  }
  const first = statuses.reduce((a, b) => ((a.opensInMin ?? Infinity) <= (b.opensInMin ?? Infinity) ? a : b));
  return {
    moscowTime: hhmm,
    isOpen: false,
    window: first.window,
    ...(first.opensAt ? { opensAt: first.opensAt } : {}),
    approximate,
  };
};
