// Выгрузка официальной страницы режима работы станций Петербургского метрополитена
// и разбор её таблицы в машиночитаемый JSON.
//
// Источник — ОДИН запрос: GET https://metro.spb.ru/rejimrabotystancii.html
// На странице одна большая HTML-таблица с секциями по линиям: каждая строка — вестибюль
// станции с временем открытия, закрытия на вход и на выход, временами первых поездов в обе
// конечные (раздельно по нечётным/чётным датам — поезда ходят по двум чередующимся графикам)
// и последних поездов. У станций, закрытых на реконструкцию, вместо времён — текстовая пометка.
//
// ВАЖНО (TLS): metro.spb.ru подписан сертификатом «Russian Trusted Root CA» (Минцифры),
// которого нет в комплекте корневых сертификатов Node.js, — обычный fetch() падает с ошибкой
// SELF_SIGNED_CERT_IN_CHAIN. Вместо отключения проверки сертификата запрос выполняется через
// node:https с закреплённым корневым сертификатом (файл russian-trusted-root-ca.pem рядом
// со скриптом; отпечаток SHA-256 указан в README).
//
// Запуск: node fetch-data.js
// Сохраняет rejimrabotystancii.html (исходник) и spb-official-hours.json (разобранные данные).
// Ванильный JavaScript (ESM), без зависимостей. Требуется Node.js 18+.

import { readFile, writeFile } from 'node:fs/promises';
import * as https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const URL = 'https://metro.spb.ru/rejimrabotystancii.html';

// ── скачивание с закреплённым корневым сертификатом ──────────────────────────
const ca = await readFile(join(OUT_DIR, 'russian-trusted-root-ca.pem'), 'utf8');
const html = await new Promise((resolve, reject) => {
  const req = https.get(
    URL,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, ca, timeout: 45_000 },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} при запросе ${URL}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    },
  );
  req.on('timeout', () => req.destroy(new Error(`Тайм-аут при запросе ${URL}`)));
  req.on('error', reject);
});
await writeFile(join(OUT_DIR, 'rejimrabotystancii.html'), html, 'utf8');

// ── разбор таблицы ───────────────────────────────────────────────────────────
const strip = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
const TIME_RE = /^\d{1,2}:\d{2}$/;

const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
const table = tables.find((t) => /ЛИНИЯ\s*\d/.test(t));
if (!table) {
  throw new Error('Таблица режима работы не найдена — вёрстка страницы изменилась');
}

// Время окончания переходов между линиями упоминается отдельной фразой над таблицей
const transferCloseTime = html.match(/[Пп]ереход[\s\S]{0,200}?заканчивается в\s*(\d{1,2}:\d{2})/)?.[1] ?? null;

const rows = [];
let line = 0;
let directions = null; // конечные станции — направления колонок первых/последних поездов
for (const tr of table.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
  const cells = [...tr[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/g)].map((c) => strip(c[0]));
  const lineHeader = cells.length === 1 && cells[0] ? cells[0].match(/^ЛИНИЯ\s*(\d+)/) : null;
  if (lineHeader) {
    line = Number(lineHeader[1]);
    directions = null;
    continue;
  }
  if (cells.length === 4 && line > 0 && !directions && cells[0] && cells[1]) {
    directions = [cells[0], cells[1]];
    continue;
  }
  if (line === 0 || !cells[0] || !/^\d+$/.test(cells[0]) || cells.length < 3) {
    continue;
  }
  const title = cells[1] ?? '';
  const m = title.match(/станции\s+(.+?)(?:\s*\(|$)/);
  const station = ((m ? m[1] : title.replace(/\s*\(.*/, '')) ?? '').trim();
  const rest = cells.slice(2);
  // Первое время из ячейки. Отдельные ячейки содержат несколько времён с пояснениями:
  // «5:34 нечет / 5:36 чет» (разное время по чётным/нечётным датам) или
  // «6:30 c 01.08.2026 5:26» (смена времени с даты) — берём первое, действующее сейчас.
  const cellTime = (s) => s?.match(/\d{1,2}:\d{2}/)?.[0] ?? null;
  if (!cellTime(rest[0])) {
    // строка закрытой станции: вместо времён — пометка («Станция закрыта на реконструкцию»)
    rows.push({ line, title, station, note: rest.filter(Boolean).join('; ') });
    continue;
  }
  const row = {
    line,
    title,
    station,
    open: cellTime(rest[0]),
    closeEntry: cellTime(rest[1]),
    closeExit: cellTime(rest[2]),
  };
  const times = rest.slice(3).map(cellTime);
  if (directions && times.length >= 6 && times.slice(0, 6).every(Boolean)) {
    row.first = [
      { direction: directions[0], odd: times[0], even: times[1] },
      { direction: directions[1], odd: times[2], even: times[3] },
    ];
    row.last = [
      { direction: directions[0], time: times[4] },
      { direction: directions[1], time: times[5] },
    ];
  }
  rows.push(row);
}

// ── проверка правдоподобия ───────────────────────────────────────────────────
const lines = new Set(rows.map((r) => r.line));
const withHours = rows.filter((r) => r.open && r.closeEntry).length;
if (rows.length < 60 || lines.size < 5 || withHours < 50) {
  throw new Error(
    `Извлечённые данные неправдоподобны (${rows.length} строк, ${lines.size} линий, ${withHours} с временами) — вёрстка изменилась`,
  );
}

const out = { source: URL, fetchedAt: new Date().toISOString(), transferCloseTime, rows };
await writeFile(join(OUT_DIR, 'spb-official-hours.json'), JSON.stringify(out, null, 2), 'utf8');

const closed = rows.filter((r) => r.note);
console.log(
  `Готово: линий ${lines.size}, строк-вестибюлей ${rows.length}, с временами работы ${withHours}, переходы до ${transferCloseTime}`,
);
for (const r of closed) {
  console.log(`  пометка: линия ${r.line}, ${r.station} — ${r.note}`);
}
