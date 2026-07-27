// Выгрузка данных схемы метро Санкт-Петербурга с сайта spb.metrobook.ru для автономного
// построения маршрутов.
//
// Сайт устроен так же, как московский metrobook.ru: весь взвешенный граф метро зашит прямо
// в HTML главной страницы, поэтому достаточно ОДНОГО запроса GET https://spb.metrobook.ru/.
//
// Внутри страницы:
//   - инлайн-скрипт со структурами:
//       mb.arrSD[sdid] = {sid, lid, sN}         — «станция на линии» (вершина графа);
//       mb.arrS[sid]   = {sdids: [...]}          — физическая станция = группа вершин;
//       mb.arrR[rid]   = {ttime, sdid1, sdid2, lid} — перегон, ttime — время хода в секундах;
//       mb.arrTT[sdid][sdid2] = секунды          — время пересадки (999999 — переход запрещён);
//       mb.arrL[lid]   = {type}                  — линии (в СПб все type 0 — метро);
//   - элементы <span mb_sd_id='NN' class='stName ...'>Название</span> — названия станций.
//
// Отличия от московской страницы: контейнеры mb.arr* здесь — разреженные массивы, а не
// объекты (индекс 0 пуст), поэтому пустые элементы отфильтровываются; номера линий lid
// совпадают с публичными номерами линий метрополитена (1–5).
//
// Скрипт скачивает страницу, извлекает граф и названия и сохраняет нормализованный
// spb-metrobook-graph.json. Исходная страница сохраняется в index.html для контроля.
//
// Запуск: node fetch-data.js
// Ванильный JavaScript (ESM), без зависимостей. Требуется Node.js 18+.

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const URL = 'https://spb.metrobook.ru/';

const res = await fetch(URL, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
});
if (!res.ok) {
  throw new Error(`HTTP ${res.status} при запросе ${URL}`);
}
const html = await res.text();
await writeFile(join(OUT_DIR, 'index.html'), html, 'utf8');

// ── извлекаем инлайн-скрипт с данными графа ──────────────────────────────────
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const dataScript = scripts.find((s) => s.includes('mb.arrSD[') && s.includes('mb.arrR['));
if (!dataScript) {
  throw new Error('Инлайн-скрипт с данными графа не найден — вёрстка сайта изменилась');
}

// Выполняем скрипт в изолированном контексте: он только наполняет объект mb
const mb = { arrS: {}, arrSD: {}, arrR: {}, arrTT: [], arrDL: [], arrL: [] };
new Function('mb', dataScript.replace(/var mb = new Object;[^;]*;/, '')).call(null, mb);

// ── названия станций из вёрстки ──────────────────────────────────────────────
const names = {}; // sdid -> название
for (const m of html.matchAll(/<span mb_sd_id='(\d+)' class='stName[^']*'>([^<]+)<\/span>/g)) {
  names[m[1]] = m[2]
    .replace(/\\n|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── нормализованный JSON (пустые элементы разреженных массивов отбрасываются) ─
const entries = (obj) => Object.entries(obj).filter(([, v]) => !!v);
const graph = {
  source: URL,
  fetchedAt: new Date().toISOString(),
  mapId: Number((dataScript.match(/mb\.mid=(\d+)/) || [])[1] ?? 0),
  lines: Object.fromEntries(entries(mb.arrL).map(([lid, l]) => [lid, { type: l.type }])),
  stationInstances: Object.fromEntries(
    entries(mb.arrSD).map(([sdid, sd]) => [sdid, { stationId: sd.sid, lineId: sd.lid, name: names[sdid] ?? null }]),
  ),
  stations: Object.fromEntries(
    entries(mb.arrS).map(([sid, s]) => [
      sid,
      { sdids: s.sdids, name: s.sdids.map((d) => names[String(d)]).find(Boolean) ?? null },
    ]),
  ),
  edges: entries(mb.arrR).map(([rid, r]) => ({
    id: Number(rid),
    sdid1: r.sdid1,
    sdid2: r.sdid2,
    lineId: r.lid,
    time: r.ttime,
  })),
  transfers: Object.entries(mb.arrTT).flatMap(([from, row]) =>
    Object.entries(row ?? {}).map(([to, time]) => ({ from: Number(from), to: Number(to), time })),
  ),
};

// ── проверка правдоподобия (в СПб ~73 вершины и ~68 перегонов) ───────────────
const nInstances = Object.keys(graph.stationInstances).length;
const nNamed = Object.values(graph.stationInstances).filter((s) => s.name).length;
if (nInstances < 60 || graph.edges.length < 55 || nNamed < 55) {
  throw new Error(
    `Извлечённый граф неправдоподобен (${nInstances} вершин, ${graph.edges.length} перегонов, ${nNamed} с названиями) — вёрстка изменилась`,
  );
}

await writeFile(join(OUT_DIR, 'spb-metrobook-graph.json'), JSON.stringify(graph, null, 2), 'utf8');
console.log(
  `Готово: линий ${Object.keys(graph.lines).length}, физических станций ${Object.keys(graph.stations).length}, вершин ${nInstances}, перегонов ${graph.edges.length}, записей о пересадках ${graph.transfers.length}`,
);
