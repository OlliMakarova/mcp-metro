// Модуль построения графа Московского метро из данных prodapp.mosmetro.ru
// и поиска оптимальных маршрутов между станциями.
//
// Источники данных:
//   https://prodapp.mosmetro.ru/api/schema/v1.0        — станции, линии, перегоны, переходы
//   https://prodapp.mosmetro.ru/api/notifications/v2   — закрытия станций, перегонов, переходов
//
// Вес каждого ребра — время в секундах (поле pathLength).
// Поиск маршрута — алгоритм Дейкстры; варианты маршрутов — алгоритм Йена (k кратчайших путей).
//
// Ванильный JavaScript (ESM), без внешних зависимостей. Работает в Node.js 18+ и в браузере.

// ─────────────────────────────────────────────────────────────────────────────
// Построение графа
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Строит граф метро из JSON схемы и (опционально) JSON уведомлений.
 *
 * @param {object} schemaJson        Ответ /api/schema/v1.0 (целиком или его поле data)
 * @param {object} [notificationsJson] Ответ /api/notifications/v2 (целиком или его поле data)
 * @param {object} [opts]
 * @param {Date|string} [opts.at]    Момент времени, на который применяются уведомления (по умолчанию — сейчас)
 * @returns граф: { stations, lines, adj, closedStations, warnings }
 */
export function buildGraph(schemaJson, notificationsJson = null, opts = {}) {
  const at = opts.at ? new Date(opts.at) : new Date();
  const data = schemaJson.data ?? schemaJson;

  const stations = new Map(data.stations.map((s) => [s.id, s]));
  const lines = new Map(data.lines.map((l) => [l.id, l]));

  // Что извлекаем из активных уведомлений
  const closedStations = new Map(); // stationId -> текст причины
  const closedConnections = new Set(); // id закрытых перегонов
  const closedTransitions = new Set(); // id закрытых переходов
  const extraConnections = []; // временные альтернативные перегоны
  const extraTransitions = []; // временные альтернативные переходы
  const warnings = new Map(); // stationId -> [{ status, title, description }]

  if (notificationsJson) {
    const list = notificationsJson.data ?? notificationsJson;
    for (const n of list) {
      const start = new Date(n.startDate);
      const end = new Date(n.endDate);
      if (!(start <= at && at <= end)) {
        continue;
      } // уведомление не активно на момент at

      for (const s of n.stations ?? []) {
        if (s.status === 'CLOSED') {
          closedStations.set(s.stationId, s.description?.ru ?? n.title?.ru ?? 'Станция закрыта');
        } else {
          // EMERGENCY / INFO — предупреждение (ремонт эскалатора, лифта и т. п.), на маршрут не влияет
          if (!warnings.has(s.stationId)) {
            warnings.set(s.stationId, []);
          }
          warnings.get(s.stationId).push({
            status: s.status,
            title: s.title?.ru ?? '',
            description: s.description?.ru ?? '',
          });
        }
      }
      for (const c of n.connections ?? []) {
        if (c.status === 'CLOSED') {
          closedConnections.add(c.connectionId);
        }
      }
      for (const t of n.transitions ?? []) {
        if (t.status === 'CLOSED') {
          closedTransitions.add(t.transitionId);
        }
      }
      extraConnections.push(...(n.alternativeConnections ?? []));
      extraTransitions.push(...(n.alternativeTransitions ?? []));
    }
  }

  // Список смежности: stationId -> массив рёбер { to, time, kind, edgeId, lineId, ground }
  const adj = new Map();
  for (const id of stations.keys()) {
    adj.set(id, []);
  }

  const addEdge = (from, to, time, kind, edgeId, extra = {}) => {
    if (!stations.has(from) || !stations.has(to)) {
      return;
    } // защита от битых ссылок
    adj.get(from).push({ from, to, time, kind, edgeId, ...extra });
  };

  // Перегоны (поездка на поезде между соседними станциями одной линии)
  for (const c of [...data.connections, ...extraConnections]) {
    if (closedConnections.has(c.id)) {
      continue;
    }
    const lineId = stations.get(c.stationFromId)?.lineId ?? null;
    addEdge(c.stationFromId, c.stationToId, c.pathLength, 'ride', c.id, { lineId, alternative: !!c.alternative });
    if (c.bi) {
      addEdge(c.stationToId, c.stationFromId, c.pathLength, 'ride', c.id, { lineId, alternative: !!c.alternative });
    }
  }

  // Переходы (пересадка пешком между станциями разных линий)
  for (const t of [...data.transitions, ...extraTransitions]) {
    if (closedTransitions.has(t.id)) {
      continue;
    }
    addEdge(t.stationFromId, t.stationToId, t.pathLength, 'transfer', t.id, { ground: !!t.ground });
    if (t.bi) {
      addEdge(t.stationToId, t.stationFromId, t.pathLength, 'transfer', t.id, { ground: !!t.ground });
    }
  }

  // Закрытая станция: на ней нельзя начинать/заканчивать маршрут и делать пересадку.
  // Проезд «сквозь» станцию оставляем возможным, только если перегоны через неё не закрыты явно
  // (в реальных уведомлениях закрытие станции сопровождается закрытием её перегонов).
  for (const id of closedStations.keys()) {
    if (!adj.has(id)) {
      continue;
    }
    adj.set(
      id,
      adj.get(id).filter((e) => e.kind !== 'transfer'),
    );
    for (const [, edges] of adj) {
      for (let i = edges.length - 1; i >= 0; i--) {
        if (edges[i].kind === 'transfer' && edges[i].to === id) {
          edges.splice(i, 1);
        }
      }
    }
  }

  return { stations, lines, adj, closedStations, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Алгоритм Дейкстры (кратчайший путь по времени)
// ─────────────────────────────────────────────────────────────────────────────

/** Простая двоичная куча-минимум для очереди с приоритетами. */
class MinHeap {
  constructor() {
    this.a = [];
  }

  push(item) {
    const { a } = this;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].dist <= a[i].dist) {
        break;
      }
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const { a } = this;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].dist < a[m].dist) {
          m = l;
        }
        if (r < a.length && a[r].dist < a[m].dist) {
          m = r;
        }
        if (m === i) {
          break;
        }
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }

  get size() {
    return this.a.length;
  }
}

/**
 * Кратчайший по времени путь от fromId к toId.
 *
 * @param {object} graph            Результат buildGraph()
 * @param {number} fromId           id станции отправления
 * @param {number} toId             id станции назначения
 * @param {object} [opts]
 * @param {number} [opts.transferPenalty] Штраф в секундах за каждую пересадку (по умолчанию 0)
 * @param {Set}    [opts.bannedNodes]     id станций, через которые идти нельзя (для алгоритма Йена)
 * @param {Set}    [opts.bannedEdges]     ключи рёбер "from-to-edgeId", которые использовать нельзя
 * @returns {null | { time, edges }}      время в секундах и список рёбер пути, либо null, если пути нет
 */
export function dijkstra(graph, fromId, toId, opts = {}) {
  const transferPenalty = opts.transferPenalty ?? 0;
  const bannedNodes = opts.bannedNodes ?? null;
  const bannedEdges = opts.bannedEdges ?? null;

  const dist = new Map();
  const prevEdge = new Map();
  const heap = new MinHeap();
  dist.set(fromId, 0);
  heap.push({ id: fromId, dist: 0 });

  while (heap.size) {
    const { id, dist: d } = heap.pop();
    if (d > (dist.get(id) ?? Infinity)) {
      continue;
    } // устаревшая запись в куче
    if (id === toId) {
      break;
    }

    for (const e of graph.adj.get(id) ?? []) {
      if (bannedNodes && bannedNodes.has(e.to)) {
        continue;
      }
      if (bannedEdges && bannedEdges.has(`${e.from}-${e.to}-${e.edgeId}`)) {
        continue;
      }
      const w = e.time + (e.kind === 'transfer' ? transferPenalty : 0);
      const nd = d + w;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prevEdge.set(e.to, e);
        heap.push({ id: e.to, dist: nd });
      }
    }
  }

  if (!dist.has(toId)) {
    return null;
  }

  // Восстанавливаем путь по цепочке рёбер
  const edges = [];
  let cur = toId;
  while (cur !== fromId) {
    const e = prevEdge.get(cur);
    if (!e) {
      return null;
    }
    edges.unshift(e);
    cur = e.from;
  }
  return { time: dist.get(toId), edges };
}

// ─────────────────────────────────────────────────────────────────────────────
// Алгоритм Йена: k кратчайших путей (варианты маршрутов)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Находит до k различных маршрутов от fromId к toId в порядке возрастания времени.
 * Классический алгоритм Йена поверх Дейкстры: поочерёдно запрещает рёбра уже
 * найденных путей и ищет «ответвления» (spur paths).
 *
 * @returns массив результатов dijkstra: [{ time, edges }, ...]
 */
export function yenKShortestPaths(graph, fromId, toId, k = 3, opts = {}) {
  const first = dijkstra(graph, fromId, toId, opts);
  if (!first) {
    return [];
  }
  const paths = [first];
  const candidates = [];

  for (let ki = 1; ki < k; ki++) {
    const prevPath = paths[ki - 1].edges;

    for (let i = 0; i < prevPath.length; i++) {
      const spurNode = i === 0 ? fromId : prevPath[i - 1].to;
      const rootEdges = prevPath.slice(0, i);
      const rootTime = rootEdges.reduce(
        (s, e) => s + e.time + (e.kind === 'transfer' ? (opts.transferPenalty ?? 0) : 0),
        0,
      );

      // Запрещаем рёбра, которыми уже найденные пути продолжались из spurNode после того же префикса
      const bannedEdges = new Set(opts.bannedEdges ?? []);
      for (const p of paths) {
        const pe = p.edges;
        if (pe.length > i && sameEdgePrefix(pe, rootEdges, i)) {
          bannedEdges.add(`${pe[i].from}-${pe[i].to}-${pe[i].edgeId}`);
        }
      }
      // Запрещаем узлы корневого префикса (кроме spurNode), чтобы не было петель
      const bannedNodes = new Set([fromId]);
      for (const e of rootEdges) {
        bannedNodes.add(e.from);
      }
      bannedNodes.delete(spurNode);

      const spur = dijkstra(graph, spurNode, toId, { ...opts, bannedNodes, bannedEdges });
      if (!spur) {
        continue;
      }

      const total = { time: rootTime + spur.time, edges: [...rootEdges, ...spur.edges] };
      const key = total.edges.map((e) => `${e.from}-${e.to}`).join('|');
      if (!candidates.some((c) => c.key === key) && !paths.some((p) => pathKey(p) === key)) {
        candidates.push({ ...total, key });
      }
    }

    if (!candidates.length) {
      break;
    }
    candidates.sort((a, b) => a.time - b.time);
    const best = candidates.shift();
    paths.push({ time: best.time, edges: best.edges });
  }

  return paths;
}

function sameEdgePrefix(pathEdges, rootEdges, len) {
  for (let j = 0; j < len; j++) {
    const a = pathEdges[j];
    const b = rootEdges[j];
    if (a.from !== b.from || a.to !== b.to || a.edgeId !== b.edgeId) {
      return false;
    }
  }
  return true;
}

function pathKey(p) {
  return p.edges.map((e) => `${e.from}-${e.to}`).join('|');
}

// ─────────────────────────────────────────────────────────────────────────────
// Высокоуровневый поиск маршрутов с понятной раскладкой по этапам
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ищет варианты маршрутов и раскладывает каждый на понятные этапы:
 * поездки по линиям и пересадки, с суммарным временем.
 *
 * @param {object} graph   Результат buildGraph()
 * @param {number} fromId  id станции отправления
 * @param {number} toId    id станции назначения
 * @param {object} [opts]
 * @param {number}  [opts.k]                Сколько вариантов маршрута вернуть (по умолчанию 3)
 * @param {number}  [opts.transferPenalty]  Штраф в секундах за пересадку (по умолчанию 0)
 * @param {boolean} [opts.includeEnterExit] Добавлять время входа на станцию и выхода (по умолчанию false —
 *                                          официальный сайт показывает время без входа/выхода)
 * @returns массив маршрутов: [{ totalTime, rideTime, transferTime, enterTime, exitTime, transfers, legs }]
 */
export function findRoutes(graph, fromId, toId, opts = {}) {
  const { k = 3, includeEnterExit = false } = opts;

  if (graph.closedStations.has(fromId)) {
    throw new Error(`Станция отправления закрыта: ${graph.closedStations.get(fromId)}`);
  }
  if (graph.closedStations.has(toId)) {
    throw new Error(`Станция назначения закрыта: ${graph.closedStations.get(toId)}`);
  }

  const raw = yenKShortestPaths(graph, fromId, toId, k, opts);

  return raw.map(({ edges }) => {
    // Группируем последовательные перегоны одной линии в один этап «поездка»
    const legs = [];
    let rideTime = 0;
    let transferTime = 0;
    let transfers = 0;

    for (const e of edges) {
      if (e.kind === 'ride') {
        rideTime += e.time;
        const last = legs[legs.length - 1];
        if (last && last.kind === 'ride' && last.lineId === e.lineId) {
          last.toId = e.to;
          last.time += e.time;
          last.stationsCount += 1;
        } else {
          legs.push({ kind: 'ride', lineId: e.lineId, fromId: e.from, toId: e.to, time: e.time, stationsCount: 1 });
        }
      } else {
        transferTime += e.time;
        transfers += 1;
        legs.push({ kind: 'transfer', fromId: e.from, toId: e.to, time: e.time, ground: !!e.ground });
      }
    }

    const enterTime = includeEnterExit ? (graph.stations.get(fromId)?.enterTime ?? 0) : 0;
    const exitTime = includeEnterExit ? (graph.stations.get(toId)?.exitTime ?? 0) : 0;
    const penalty = (opts.transferPenalty ?? 0) * transfers;

    return {
      totalTime: enterTime + rideTime + transferTime + penalty + exitTime,
      rideTime,
      transferTime,
      enterTime,
      exitTime,
      transfers,
      legs,
      edges,
    };
  });
}

/**
 * Ищет станции по названию (без учёта регистра, допускает частичное совпадение).
 * Возвращает все совпадения — одноимённые станции на разных линиях различаются полем lineId.
 */
export function findStationsByName(graph, name) {
  const q = name.trim().toLowerCase();
  const exact = [];
  const partial = [];
  for (const s of graph.stations.values()) {
    const n = (s.name?.ru ?? '').toLowerCase();
    if (n === q) {
      exact.push(s);
    } else if (n.includes(q)) {
      partial.push(s);
    }
  }
  return exact.length ? exact : partial;
}
