// Автономный поиск быстрейшего маршрута по данным metrobook.ru (без запросов в сеть).
//
// Запуск:
//   node route-cli.js "Станция откуда" "Станция куда"
//
// Данные должны быть предварительно извлечены: node fetch-data.js
// Граф: вершины — «станция на линии» (sdid), рёбра — перегоны (edges, время хода в секундах)
// и пересадки (transfers, время перехода в секундах; 999999 — переход запрещён).
// Поиск — алгоритм Дейкстры. Ванильный JavaScript, без зависимостей, Node.js 18+.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const g = JSON.parse(await readFile(join(DIR, 'metrobook-graph.json'), 'utf8'));

const [fromName, toName] = process.argv.slice(2);
if (!fromName || !toName) {
  console.log('Использование: node route-cli.js "Станция откуда" "Станция куда"');
  process.exit(1);
}

// ── список смежности ─────────────────────────────────────────────────────────
const adj = new Map();
const addEdge = (from, to, time, kind, lineId = null) => {
  if (!adj.has(from)) {
    adj.set(from, []);
  }
  adj.get(from).push({ from, to, time, kind, lineId });
};
for (const e of g.edges) {
  addEdge(e.sdid1, e.sdid2, e.time, 'ride', e.lineId);
  addEdge(e.sdid2, e.sdid1, e.time, 'ride', e.lineId);
}
for (const t of g.transfers) {
  if (t.time < 999999) {
    addEdge(t.from, t.to, t.time, 'transfer');
  } // 999999 — запрещённый переход
}

// ── поиск станции по названию ────────────────────────────────────────────────
function findStation(name) {
  const q = name.trim().toLowerCase().replace(/ё/g, 'е');
  const norm = (s) => (s ?? '').toLowerCase().replace(/ё/g, 'е');
  const all = Object.entries(g.stations);
  const found = all.filter(([, s]) => norm(s.name) === q);
  const result = found.length ? found : all.filter(([, s]) => norm(s.name).includes(q));
  if (!result.length) {
    console.error(`Станция не найдена: «${name}»`);
    process.exit(1);
  }
  return result.map(([sid, s]) => ({ sid: Number(sid), ...s }));
}

const fromSt = findStation(fromName)[0];
const toSt = findStation(toName)[0];

// ── Дейкстра от всех вершин станции отправления до любой вершины назначения ──
function dijkstra(sources, targets) {
  const dist = new Map();
  const prev = new Map();
  const heap = [];
  const push = (id, d) => {
    heap.push({ id, d });
    heap.sort((a, b) => b.d - a.d); // для графа в ~440 вершин простая сортировка достаточна
  };
  for (const s of sources) {
    dist.set(s, 0);
    push(s, 0);
  }
  const targetSet = new Set(targets);
  while (heap.length) {
    const { id, d } = heap.pop();
    if (d > (dist.get(id) ?? Infinity)) {
      continue;
    }
    if (targetSet.has(id)) {
      const edges = [];
      let cur = id;
      while (prev.has(cur)) {
        edges.unshift(prev.get(cur));
        cur = prev.get(cur).from;
      }
      return { time: d, edges };
    }
    for (const e of adj.get(id) ?? []) {
      const nd = d + e.time;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, e);
        push(e.to, nd);
      }
    }
  }
  return null;
}

const route = dijkstra(fromSt.sdids, toSt.sdids);
if (!route) {
  console.error('Маршрут не найден.');
  process.exit(1);
}

// ── вывод: группируем перегоны одной линии в этапы ───────────────────────────
const sdName = (sdid) => {
  const inst = g.stationInstances[sdid];
  return inst?.name ?? g.stations[inst?.stationId]?.name ?? `#${sdid}`;
};
const min = (sec) => `${Math.round(sec / 60)} мин`;

console.log(`\nМаршрут: ${fromSt.name} → ${toSt.name} (данные metrobook.ru)`);
console.log(`Итого: ${min(route.time)}\n`);

const legs = [];
for (const e of route.edges) {
  const last = legs[legs.length - 1];
  if (e.kind === 'ride' && last?.kind === 'ride' && last.lineId === e.lineId) {
    last.to = e.to;
    last.time += e.time;
    last.count += 1;
  } else {
    legs.push({ kind: e.kind, lineId: e.lineId, from: e.from, to: e.to, time: e.time, count: 1 });
  }
}
for (const leg of legs) {
  if (leg.kind === 'ride') {
    console.log(
      `  линия ${leg.lineId}: ${sdName(leg.from)} → ${sdName(leg.to)} (${leg.count} перегон(а), ${min(leg.time)})`,
    );
  } else {
    console.log(`  пересадка: ${sdName(leg.from)} → ${sdName(leg.to)} (${min(leg.time)})`);
  }
}
