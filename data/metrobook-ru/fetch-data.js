// Выгрузка данных схемы метро с сайта metrobook.ru для автономного построения маршрутов.
//
// Особенность сайта: весь взвешенный граф метро зашит прямо в HTML главной страницы,
// поэтому достаточно ОДНОГО запроса GET https://metrobook.ru/.
//
// Внутри страницы:
//   - инлайн-скрипт со структурами:
//       mb.arrSD[sdid] = {sid, lid, sN}         — «станция на линии» (вершина графа);
//       mb.arrS[sid]   = {sdids: [...]}          — физическая станция = группа вершин;
//       mb.arrR[rid]   = {ttime, sdid1, sdid2, lid} — перегон, ttime — время хода в секундах;
//       mb.arrTT[sdid][sdid2] = секунды          — время пересадки (999999 — переход запрещён);
//       mb.arrL[lid]   = {type}                  — линии (0 — метро, 1 — МЦК, 2 — МЦД);
//   - элементы <div class='stName' mb_sd_id='NN'>Название</div> — названия станций.
//
// Скрипт скачивает страницу, извлекает граф и названия и сохраняет нормализованный
// metrobook-graph.json. Исходная страница сохраняется в index.html для контроля.
//
// Запуск: node fetch-data.js
// Ванильный JavaScript (ESM), без зависимостей. Требуется Node.js 18+.

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const URL = 'https://metrobook.ru/';

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
// <div ... class='stName' mb_sd_id='460'> <span ...>Ховрино</span> </div>
const names = {}; // sdid -> название
for (const m of html.matchAll(/<span mb_sd_id='(\d+)' class='stName[^']*'>([^<]+)<\/span>/g)) {
  names[m[1]] = m[2]
    .replace(/\\n|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── нормализованный JSON ─────────────────────────────────────────────────────
const graph = {
  source: URL,
  fetchedAt: new Date().toISOString(),
  mapId: Number((dataScript.match(/mb\.mid=(\d+)/) || [])[1] ?? 0),
  lines: Object.fromEntries(Object.entries(mb.arrL).map(([lid, l]) => [lid, { type: l.type }])),
  // вершина графа: «станция на линии»
  stationInstances: Object.fromEntries(
    Object.entries(mb.arrSD).map(([sdid, sd]) => [
      sdid,
      { stationId: sd.sid, lineId: sd.lid, name: names[sdid] ?? null },
    ]),
  ),
  // физическая станция — группа вершин, название берём у любой именованной вершины группы
  stations: Object.fromEntries(
    Object.entries(mb.arrS).map(([sid, s]) => [
      sid,
      { sdids: s.sdids, name: s.sdids.map((d) => names[d]).find(Boolean) ?? null },
    ]),
  ),
  // перегоны: время хода поезда в секундах
  edges: Object.entries(mb.arrR).map(([rid, r]) => ({
    id: Number(rid),
    sdid1: r.sdid1,
    sdid2: r.sdid2,
    lineId: r.lid,
    time: r.ttime,
  })),
  // пересадки: время пешего перехода в секундах; 999999 означает «переход запрещён»
  transfers: Object.entries(mb.arrTT).flatMap(([from, row]) =>
    Object.entries(row ?? {}).map(([to, time]) => ({ from: Number(from), to: Number(to), time })),
  ),
};

const outPath = join(OUT_DIR, 'metrobook-graph.json');
await writeFile(outPath, JSON.stringify(graph, null, 1), 'utf8');

console.log(`Сохранено: ${outPath}`);
console.log(
  `Станций: ${Object.keys(graph.stations).length}, вершин (станция×линия): ` +
    `${Object.keys(graph.stationInstances).length}, перегонов: ${graph.edges.length}, ` +
    `пересадок: ${graph.transfers.length}`,
);
const unnamed = Object.values(graph.stationInstances).filter((s) => !s.name).length;
if (unnamed) {
  console.warn(`Вершин без названия: ${unnamed} (названия есть у физических станций рядом)`);
}
