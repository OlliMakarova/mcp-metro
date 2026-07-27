// Download and parsing of the official Saint Petersburg metro operating-hours page.
//
// https://metro.spb.ru/rejimrabotystancii.html publishes one large HTML table with per-line
// sections: every row is a station vestibule with its opening time, entry/exit closing times,
// first trains towards each terminus (split into odd/even days of the month — SPb trains run on
// two alternating timetables) and last trains. Rows of stations closed for reconstruction carry
// a textual note instead of times — these become CLOSED notifications in the dataset.
//
// The table layout (observed 2026-07): a line section starts with a single-cell row «ЛИНИЯ N»,
// followed by a 4-cell row naming the two directions (termini), then vestibule rows:
//   [№, vestibule title, open, close-entry, close-exit, first(dir1 odd), first(dir1 even),
//    first(dir2 odd), first(dir2 even), last(dir1), last(dir2)]
// Secondary vestibules of the same station repeat only the first 5 cells. A closed station's
// row is [№, station name, note text].

import { httpsGetTextPinnedRussianCa } from './spb-official-tls.js';

/** One vestibule row of the official operating-hours table */
export interface ISpbVestibuleRow {
  /** Line number (1..6) of the table section the row belongs to */
  line: number;
  /** Vestibule cell text, e.g. «Вестибюль 1 станции Проспект Ветеранов (выход на Дачный пр.)» */
  title: string;
  /** Station name extracted from the title */
  station: string;
  /** Vestibule opening time, «5:38» */
  open?: string;
  /** Entry closing time */
  closeEntry?: string;
  /** Exit closing time */
  closeExit?: string;
  /** First trains towards each terminus: [odd-day time, even-day time] */
  first?: Array<{ direction: string; odd: string; even: string }>;
  /** Last trains towards each terminus (same time on odd/even days in the source) */
  last?: Array<{ direction: string; time: string }>;
  /** Closure/restriction note when the row carries text instead of times */
  note?: string;
}

/** Parsed official operating-hours page, as stored on disk */
export interface ISpbOfficialFile {
  fetchedAt: string;
  sourceUrl: string;
  /** Time when inter-line transfers close, e.g. «00:15», when the page states it */
  transferCloseTime?: string;
  rows: ISpbVestibuleRow[];
}

export interface ISpbOfficialFetchOpts {
  url: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const stripTags = (s: string): string =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();

const TIME_ANY_RE = /\d{1,2}:\d{2}/;

/** Station name from a vestibule title: «Вестибюль 2 станции X (выход …)» → «X»; plain names pass through */
const stationFromTitle = (title: string): string => {
  const m = title.match(/станции\s+(.+?)(?:\s*\(|$)/);
  const name = ((m ? m[1] : title.replace(/\s*\(.*/, '')) ?? '').trim();
  return name.replace(/\s+/g, ' ');
};

/**
 * Extracts vestibule rows from the page HTML. Throws a clear error when the markup no longer
 * matches the expected structure (the page is designed for humans and may change).
 */
export const parseSpbOfficialHtml = (html: string, fetchedAt: string, sourceUrl: string): ISpbOfficialFile => {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
  // The operating-hours table is the one containing line sections «ЛИНИЯ N»
  const table = tables.find((t) => /ЛИНИЯ\s*\d/.test(t));
  if (!table) {
    throw new Error('metro.spb.ru: operating-hours table not found — the page markup has changed');
  }

  const transferClose = html.match(/[Пп]ереход[\s\S]{0,200}?заканчивается в\s*(\d{1,2}:\d{2})/)?.[1];

  const rows: ISpbVestibuleRow[] = [];
  let line = 0;
  let directions: [string, string] | null = null;

  for (const trMatch of table.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    const cells = [...trMatch[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/g)].map((c) => stripTags(c[0]));
    const lineHeader = cells.length >= 1 && cells[0] ? cells[0].match(/^ЛИНИЯ\s*(\d+)/) : null;
    if (cells.length === 1 && lineHeader) {
      line = Number(lineHeader[1]);
      directions = null;
      continue;
    }
    // The direction sub-header: 4 cells, first two are the termini of first-train columns
    if (cells.length === 4 && line > 0 && !directions && cells[0] && cells[1]) {
      directions = [cells[0], cells[1]];
      continue;
    }
    if (line === 0 || !cells[0] || !/^\d+$/.test(cells[0]) || cells.length < 3) {
      continue;
    }
    const title = cells[1] ?? '';
    const station = stationFromTitle(title);
    if (!station) {
      continue;
    }
    const rest = cells.slice(2);
    // First time of a cell. Some cells carry several times with qualifiers: «5:34 нечет /
    // 5:36 чет» (different opening on odd/even dates) or «6:30 c 01.08.2026 5:26» (a change
    // scheduled from a date) — the first time is the one in effect now.
    const cellTime = (s: string | undefined): string | null => s?.match(TIME_ANY_RE)?.[0] ?? null;
    // A closed station: the row carries a note instead of times
    if (!cellTime(rest[0])) {
      rows.push({ line, title, station, note: rest.filter(Boolean).join('; ') });
      continue;
    }
    const row: ISpbVestibuleRow = { line, title, station };
    const open = cellTime(rest[0]);
    const closeEntry = cellTime(rest[1]);
    const closeExit = cellTime(rest[2]);
    if (open) {
      row.open = open;
    }
    if (closeEntry) {
      row.closeEntry = closeEntry;
    }
    if (closeExit) {
      row.closeExit = closeExit;
    }
    // Full rows additionally carry 4 first-train times and 2 last-train times
    const times = rest.slice(3).map(cellTime);
    if (directions && times.length >= 6 && times.slice(0, 6).every(Boolean)) {
      row.first = [
        { direction: directions[0], odd: times[0]!, even: times[1]! },
        { direction: directions[1], odd: times[2]!, even: times[3]! },
      ];
      row.last = [
        { direction: directions[0], time: times[4]! },
        { direction: directions[1], time: times[5]! },
      ];
    }
    rows.push(row);
  }

  const file: ISpbOfficialFile = {
    fetchedAt,
    sourceUrl,
    ...(transferClose ? { transferCloseTime: transferClose } : {}),
    rows,
  };
  validateSpbOfficial(file);
  return file;
};

/** Plausibility check: SPb has 70+ vestibules across 5+ lines */
export const validateSpbOfficial = (f: ISpbOfficialFile): void => {
  const lines = new Set(f.rows.map((r) => r.line));
  const withHours = f.rows.filter((r) => r.open && r.closeEntry).length;
  if (f.rows.length < 60 || lines.size < 5 || withHours < 50) {
    throw new Error(
      `metro.spb.ru: extracted operating hours are implausible (${f.rows.length} rows, ${lines.size} lines, ${withHours} with hours) — the page markup has changed`,
    );
  }
};

export const fetchSpbOfficial = async (opts: ISpbOfficialFetchOpts): Promise<ISpbOfficialFile> => {
  let html: string;
  if (opts.fetchImpl) {
    // Test path: the injected fetch substitute
    const res = await opts.fetchImpl(opts.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} while requesting ${opts.url}`);
    }
    html = await res.text();
  } else {
    // Production path: metro.spb.ru is signed by the Russian Trusted Root CA, which Node's
    // bundled root store does not contain — download with the pinned trust anchor instead
    html = await httpsGetTextPinnedRussianCa(opts.url, opts.timeoutMs);
  }
  return parseSpbOfficialHtml(html, (opts.now?.() ?? new Date()).toISOString(), opts.url);
};
