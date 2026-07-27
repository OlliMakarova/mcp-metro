// Автономный расчёт маршрута по данным spb-route-map.json — воспроизводит движок
// калькулятора https://metro.spb.ru/map1/route.html (files/route000.js) без браузера.
//
// Модель сайта: у каждой станции две «платформы» — pn (в сторону следующей станции линии)
// и pp (в сторону предыдущей). Рёбра графа:
//   - перегон: платформа -> одноимённая платформа соседней станции, время из edges[]
//     (вычислено из пиксельного расстояния на схеме), погрешность rideFaultSec;
//   - пересадка: все 4 пары платформ двух станций, transferSec ± transferFaultSec;
//   - разворот на своей линии (только у пересадочных станций): pn <-> pp,
//     sameLineReverseSec ± sameLineReverseFaultSec.
// Поиск — Дейкстра по минимальному времени; погрешность накапливается вдоль пути.
// Итог показывается как на сайте: диапазон минут floor((T ∓ F ± 15 + вход×k) / 60),
// где вход 170–230 с, k=1 (только вход) или k=2 (вход и выход в город).
//
// Запуск: node route-map-cli.js "Девяткино" "Купчино"
// Ванильный JavaScript (ESM), без зависимостей. Требуется Node.js 18+.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const [fromArg, toArg] = process.argv.slice(2);
if (!fromArg || !toArg) {
  console.log('Использование: node route-map-cli.js "Станция отправления" "Станция прибытия"');
  process.exit(1);
}

const data = JSON.parse(await readFile(join(OUT_DIR, 'spb-route-map.json'), 'utf8'));
const { timing } = data;

// ── поиск станции по названию (без регистра, «ё» = «е», допускается подстрока) ──
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').trim();
const stations = new Map(); // id -> { id, title, lineNumber, lineName }
for (const line of data.lines) {
  for (const s of line.stations) {
    stations.set(s.id, { id: s.id, title: s.title ?? s.id, lineNumber: line.number, lineName: line.name });
  }
}
const findStation = (query) => {
  const q = norm(query);
  const all = [...stations.values()];
  const found = all.filter((s) => norm(s.title) === q);
  const part = found.length ? found : all.filter((s) => norm(s.title).includes(q));
  if (!part.length) {
    throw new Error(`Станция «${query}» не найдена`);
  }
  if (new Set(part.map((s) => norm(s.title))).size > 1) {
    throw new Error(`Неоднозначно «${query}»: ${part.map((s) => s.title).join(', ')}`);
  }
  return part; // одна станция может быть узлом из нескольких вершин (по одной на линию)
};

// ── сборка графа платформ ────────────────────────────────────────────────────
// Узел — строка `${id}|pn` или `${id}|pp`; ways: Map(узел -> [{aim, time, fault, transfer}])
const ways = new Map();
const addWay = (from, aim, time, fault, transfer) => {
  if (!ways.has(from)) {
    ways.set(from, []);
  }
  ways.get(from).push({ aim, time, fault, transfer });
};
for (const e of data.edges) {
  addWay(`${e.from}|pn`, `${e.to}|pn`, e.rideSec, timing.rideFaultSec, 0);
  addWay(`${e.to}|pp`, `${e.from}|pp`, e.rideSec, timing.rideFaultSec, 0);
}
const hasTransfers = new Set();
for (const t of data.transfers) {
  if (!hasTransfers.has(t.s1)) {
    // разворот на своей линии доступен только на пересадочных станциях
    addWay(`${t.s1}|pn`, `${t.s1}|pp`, timing.sameLineReverseSec, timing.sameLineReverseFaultSec, 1);
    addWay(`${t.s1}|pp`, `${t.s1}|pn`, timing.sameLineReverseSec, timing.sameLineReverseFaultSec, 1);
    hasTransfers.add(t.s1);
  }
  for (const a of ['pn', 'pp']) {
    for (const b of ['pn', 'pp']) {
      addWay(`${t.s1}|${a}`, `${t.s2}|${b}`, timing.transferSec, timing.transferFaultSec, 1);
    }
  }
}

// ── Дейкстра ────────────────────────────────────────────────────────────────
const fromNodes = findStation(fromArg);
const toNodes = findStation(toArg);
const best = new Map(); // узел -> { time, fault, from }
const queue = [];
for (const s of fromNodes) {
  for (const side of ['pn', 'pp']) {
    best.set(`${s.id}|${side}`, { time: 0, fault: 0, from: null });
    queue.push(`${s.id}|${side}`);
  }
}
const done = new Set();
while (queue.length) {
  let bi = 0;
  for (let i = 1; i < queue.length; i++) {
    if (best.get(queue[i]).time < best.get(queue[bi]).time) {
      bi = i;
    }
  }
  const [node] = queue.splice(bi, 1);
  if (done.has(node)) {
    continue;
  }
  done.add(node);
  const cur = best.get(node);
  for (const w of ways.get(node) ?? []) {
    const t = cur.time + w.time;
    if (!best.has(w.aim) || t < best.get(w.aim).time) {
      best.set(w.aim, { time: t, fault: cur.fault + w.fault, from: node });
      queue.push(w.aim);
    }
  }
}

let finish = null;
for (const s of toNodes) {
  for (const side of ['pn', 'pp']) {
    const p = best.get(`${s.id}|${side}`);
    if (p && (!finish || p.time < finish.time)) {
      finish = { ...p, node: `${s.id}|${side}` };
    }
  }
}
if (!finish) {
  throw new Error('Маршрут не найден');
}

// ── восстановление пути и вывод ──────────────────────────────────────────────
const chain = [];
for (let node = finish.node; node; node = best.get(node).from) {
  chain.push(node.split('|')[0]);
}
chain.reverse();
const path = chain.filter((id, i) => id !== chain[i - 1]); // схлопнуть разворот на месте

console.log(`Маршрут: ${stations.get(path[0]).title} -> ${stations.get(path[path.length - 1]).title}\n`);
let transfers = 0;
for (let i = 0; i < path.length; i++) {
  const s = stations.get(path[i]);
  const prev = i > 0 ? stations.get(path[i - 1]) : null;
  const mark = prev && prev.lineNumber !== s.lineNumber ? ' <- переход' : '';
  if (mark) {
    transfers++;
  }
  console.log(`  ${String(s.lineNumber).padStart(2)}  ${s.title}${mark}`);
}
const T = finish.time + 1; // сайт стартует волну со значения 1 с
const F = finish.fault;
const range = (k) => {
  const min = Math.floor((T - F + 15 + timing.entranceMinSec * k) / 60);
  const max = Math.floor((T + F - 15 + timing.entranceMaxSec * k) / 60);
  return `${min}–${max} мин`;
};
console.log(`\nВ пути: ${T} с ± ${F} с, пересадок: ${transfers}`);
console.log(`Как показывает сайт: ${range(2)} (с выходом в город), ${range(1)} (без выхода)`);
