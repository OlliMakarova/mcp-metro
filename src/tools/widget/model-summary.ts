// Concise, localized one-line route summary for the model context.
//
// The widget sends this text to the host via `ui/update-model-context` (MCP Apps): it does not
// appear in the chat, but leaves a trace of what the user saw so the model can answer follow-up
// questions. The summary is intentionally short — the fastest variant plus operating status and an
// advisory count — not the full route text.

import { pickName, TLang } from '../../lib/metro-data/localized-name.js';
import { IFindRoutesResult } from '../../lib/routing/find-routes.js';
import { endpointWarnings } from '../lib/render.js';

/** Facts extracted from the result, formatted per language below. */
interface ISummaryVals {
  from: string;
  to: string;
  count: number;
  /** Fastest total (minutes), including the walks to/from the metro when they are known */
  fastestMin: number;
  /** Walk time (minutes) to the departure station; undefined — not mentioned by the user */
  walkToMin?: number;
  /** Walk time (minutes) from the arrival station; undefined — not mentioned by the user */
  walkFromMin?: number;
  transfers: number;
  lines: string[];
  closed: boolean;
  opensAt?: string;
  closingMin?: number;
  warnings: number;
}

/** Russian plural: forms = [1, 2–4, 5+] */
const ruPlural = (n: number, forms: [string, string, string]): string => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) {
    return forms[2];
  }
  if (b > 1 && b < 5) {
    return forms[1];
  }
  if (b === 1) {
    return forms[0];
  }
  return forms[2];
};

const linesSuffix = (lines: string[], open: string, close: string): string =>
  lines.length ? ` ${open}${lines.join(', ')}${close}` : '';

/** Localized «(incl. walk …)» clause; empty when neither walk time is known */
const walkClause = (
  v: ISummaryVals,
  fmt: (min: number, dir: 'to' | 'from') => string,
  join: string,
  wrap: (body: string) => string,
): string => {
  const parts: string[] = [];
  if (v.walkToMin !== undefined) {
    parts.push(fmt(v.walkToMin, 'to'));
  }
  if (v.walkFromMin !== undefined) {
    parts.push(fmt(v.walkFromMin, 'from'));
  }
  return parts.length ? wrap(parts.join(join)) : '';
};

const FORMAT: Record<TLang, (v: ISummaryVals) => string> = {
  en: (v) => {
    const transfers = v.transfers === 0 ? 'no transfers' : `${v.transfers} transfer${v.transfers === 1 ? '' : 's'}`;
    const op = v.closed
      ? ` Metro is closed${v.opensAt ? `, opens at ${v.opensAt}` : ''}.`
      : v.closingMin !== undefined
        ? ` Metro closes in ~${v.closingMin} min.`
        : '';
    const warn = v.warnings ? ` Advisories: ${v.warnings}.` : '';
    const walk = walkClause(
      v,
      (min, dir) => `~${min} min walk ${dir === 'to' ? 'to the metro' : 'from the metro'}`,
      ' and ',
      (body) => ` (incl. ${body})`,
    );
    return `Moscow Metro route ${v.from} → ${v.to}: ${v.count} option${v.count === 1 ? '' : 's'}, fastest ~${v.fastestMin} min${walk}, ${transfers}${linesSuffix(v.lines, '(', ')')}.${op}${warn}`;
  },
  ru: (v) => {
    const transfers =
      v.transfers === 0
        ? 'без пересадок'
        : `${v.transfers} ${ruPlural(v.transfers, ['пересадка', 'пересадки', 'пересадок'])}`;
    const op = v.closed
      ? ` Метро закрыто${v.opensAt ? `, открытие в ${v.opensAt}` : ''}.`
      : v.closingMin !== undefined
        ? ` Метро закроется через ~${v.closingMin} мин.`
        : '';
    const warn = v.warnings ? ` Предупреждений: ${v.warnings}.` : '';
    const options = ruPlural(v.count, ['вариант', 'варианта', 'вариантов']);
    const walk = walkClause(
      v,
      (min, dir) => `~${min} мин пешком ${dir === 'to' ? 'до метро' : 'от метро'}`,
      ' и ',
      (body) => ` (включая ${body})`,
    );
    return `Метро Москвы, маршрут ${v.from} → ${v.to}: ${v.count} ${options}, быстрейший ~${v.fastestMin} мин${walk}, ${transfers}${linesSuffix(v.lines, '(', ')')}.${op}${warn}`;
  },
  ar: (v) => {
    const transfers = v.transfers === 0 ? 'بدون تبديل' : `${v.transfers} تبديل`;
    const op = v.closed
      ? ` المترو مغلق${v.opensAt ? `، يفتح في ${v.opensAt}` : ''}.`
      : v.closingMin !== undefined
        ? ` يُغلق المترو خلال ~${v.closingMin} د.`
        : '';
    const warn = v.warnings ? ` تنبيهات: ${v.warnings}.` : '';
    const walk = walkClause(
      v,
      (min, dir) => `~${min} د مشيًا ${dir === 'to' ? 'إلى المترو' : 'من المترو'}`,
      ' و',
      (body) => ` (شاملاً ${body})`,
    );
    return `مترو موسكو، المسار ${v.from} → ${v.to}: ${v.count} مسار، الأسرع ~${v.fastestMin} د${walk}، ${transfers}${linesSuffix(v.lines, '(', ')')}.${op}${warn}`;
  },
  cn: (v) => {
    const transfers = v.transfers === 0 ? '无需换乘' : `${v.transfers} 次换乘`;
    const op = v.closed
      ? ` 地铁已停运${v.opensAt ? `，${v.opensAt} 恢复进站` : ''}。`
      : v.closingMin !== undefined
        ? ` 地铁将于约 ${v.closingMin} 分钟后停止进站。`
        : '';
    const warn = v.warnings ? ` 注意事项：${v.warnings}。` : '';
    const walk = walkClause(
      v,
      (min, dir) => (dir === 'to' ? `步行至地铁约 ${min} 分钟` : `出站后步行约 ${min} 分钟`),
      '、',
      (body) => `（含${body}）`,
    );
    return `莫斯科地铁，路线 ${v.from} → ${v.to}：${v.count} 个方案，最快约 ${v.fastestMin} 分钟${walk}，${transfers}${linesSuffix(v.lines, '（', '）')}。${op}${warn}`;
  },
};

/** Unique ride-line names of the fastest variant, in the requested language */
const fastestLines = (result: IFindRoutesResult, lang: TLang): string[] => {
  const first = result.variants[0];
  if (!first) {
    return [];
  }
  const names: string[] = [];
  for (const leg of first.legs) {
    if (leg.kind === 'ride' && leg.line?.name) {
      const name = pickName(leg.line.name, lang);
      if (name && !names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
};

/**
 * Builds the concise, localized model-context summary for a route result. Returns an empty string
 * when no variants were found (nothing meaningful to record). `walkToMin` / `walkFromMin` — the
 * user's walk times to the departure station and from the arrival station (minutes); when given,
 * they are added to the fastest total and called out.
 */
export const buildModelSummary = (
  result: IFindRoutesResult,
  fromName: string,
  toName: string,
  lang: TLang,
  walkToMin?: number,
  walkFromMin?: number,
): string => {
  const first = result.variants[0];
  if (!first) {
    return '';
  }
  const op = result.operating;
  const closingSoon = op.isOpen && op.minutesToClose !== undefined && op.minutesToClose <= 30;
  const vals: ISummaryVals = {
    from: fromName,
    to: toName,
    count: result.variants.length,
    fastestMin: Math.round(first.totalTimeSec / 60) + (walkToMin ?? 0) + (walkFromMin ?? 0),
    ...(walkToMin !== undefined ? { walkToMin } : {}),
    ...(walkFromMin !== undefined ? { walkFromMin } : {}),
    transfers: first.transfersCount,
    lines: fastestLines(result, lang),
    closed: op.isOpen === false,
    ...(op.opensAt ? { opensAt: op.opensAt } : {}),
    ...(closingSoon ? { closingMin: op.minutesToClose } : {}),
    warnings: endpointWarnings(result.variants).length,
  };
  return FORMAT[lang](vals);
};
