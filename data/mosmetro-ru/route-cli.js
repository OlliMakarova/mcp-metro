// Консольная утилита поиска маршрутов по сохранённым данным (автономно, без запросов в сеть).
//
// Запуск:
//   node route-cli.js "Станция откуда" "Станция куда" [варианты]
//
// Параметры:
//   -k <число>        сколько вариантов маршрута показать (по умолчанию 3)
//   --no-closures     не учитывать закрытия (строить по «чистой» схеме)
//   --enter-exit      добавлять к итогу время входа на станцию и выхода в город
//                     (официальный сайт показывает время БЕЗ входа/выхода)
//
// Примеры:
//   node route-cli.js "Ховрино" "Тёплый Стан"
//   node route-cli.js "Курская" "Киевская" -k 5
//
// Данные должны быть предварительно скачаны: node fetch-data.js

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, findRoutes, findStationsByName } from './metro-graph.js';

const DIR = dirname(fileURLToPath(import.meta.url));

// ── разбор аргументов ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const positional = [];
let k = 3;
let useClosures = true;
let includeEnterExit = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-k') {
    k = Number(args[++i]) || 3;
  } else if (args[i] === '--no-closures') {
    useClosures = false;
  } else if (args[i] === '--enter-exit') {
    includeEnterExit = true;
  } else {
    positional.push(args[i]);
  }
}

if (positional.length < 2) {
  console.log('Использование: node route-cli.js "Станция откуда" "Станция куда" [-k N] [--no-closures]');
  process.exit(1);
}

// ── загрузка данных и построение графа ───────────────────────────────────────
const schema = JSON.parse(await readFile(join(DIR, 'schema-v1.0.json'), 'utf8'));
let notifications = null;
if (useClosures) {
  try {
    notifications = JSON.parse(await readFile(join(DIR, 'notifications-v2.json'), 'utf8'));
  } catch {
    console.warn('Файл notifications-v2.json не найден — маршруты строятся без учёта закрытий.');
  }
}

const graph = buildGraph(schema, notifications);

// ── поиск станций по названиям ───────────────────────────────────────────────
const lineName = (s) => graph.lines.get(s.lineId)?.name?.ru ?? `линия ${s.lineId}`;

function resolve(name) {
  const found = findStationsByName(graph, name).filter((s) => !graph.closedStations.has(s.id));
  if (!found.length) {
    console.error(`Станция не найдена или закрыта: «${name}»`);
    process.exit(1);
  }
  return found;
}

const fromCandidates = resolve(positional[0]);
const toCandidates = resolve(positional[1]);

// Одноимённые станции на разных линиях: пробуем все пары «откуда→куда» и берём лучшую по времени
let best = null;
for (const f of fromCandidates) {
  for (const t of toCandidates) {
    if (f.id === t.id) {
      continue;
    }
    const routes = findRoutes(graph, f.id, t.id, { k, includeEnterExit });
    if (routes.length && (!best || routes[0].totalTime < best.routes[0].totalTime)) {
      best = { from: f, to: t, routes };
    }
  }
}

if (!best) {
  console.error('Маршрут не найден.');
  process.exit(1);
}

// ── вывод ────────────────────────────────────────────────────────────────────
const min = (sec) => `${Math.round(sec / 60)} мин`;
const stName = (id) => graph.stations.get(id)?.name?.ru ?? `#${id}`;

console.log(`\nМаршрут: ${best.from.name.ru} (${lineName(best.from)}) → ${best.to.name.ru} (${lineName(best.to)})`);
if (!useClosures) {
  console.log('(закрытия НЕ учитываются)');
}

for (const [i, r] of best.routes.entries()) {
  console.log(`\n─── Вариант ${i + 1}: ${min(r.totalTime)} (пересадок: ${r.transfers}) ───`);
  if (r.enterTime) {
    console.log(`  вход на станцию: ${min(r.enterTime)}`);
  }
  for (const leg of r.legs) {
    if (leg.kind === 'ride') {
      const line = graph.lines.get(leg.lineId)?.name?.ru ?? `линия ${leg.lineId}`;
      console.log(
        `  ${line}: ${stName(leg.fromId)} → ${stName(leg.toId)}` +
          ` (${leg.stationsCount} перегон${leg.stationsCount === 1 ? '' : leg.stationsCount < 5 ? 'а' : 'ов'}, ${min(leg.time)})`,
      );
    } else {
      const where = leg.ground ? ' по улице' : '';
      console.log(`  пересадка${where}: ${stName(leg.fromId)} → ${stName(leg.toId)} (${min(leg.time)})`);
    }
  }
  if (r.exitTime) {
    console.log(`  выход в город: ${min(r.exitTime)}`);
  }
  console.log(
    `  итого: в пути ${min(r.rideTime)}, пересадки ${min(r.transferTime)},` +
      ` вход/выход ${min(r.enterTime + r.exitTime)}`,
  );
}

// Предупреждения по станциям маршрута (ремонты эскалаторов и т. п.)
const routeStations = new Set();
for (const e of best.routes[0].edges) {
  routeStations.add(e.from);
  routeStations.add(e.to);
}
const warned = [...routeStations].filter((id) => graph.warnings.has(id));
if (warned.length) {
  console.log('\nПредупреждения на станциях первого варианта маршрута:');
  for (const id of warned) {
    for (const w of graph.warnings.get(id)) {
      console.log(`  ${stName(id)}: ${w.title}`);
    }
  }
}
