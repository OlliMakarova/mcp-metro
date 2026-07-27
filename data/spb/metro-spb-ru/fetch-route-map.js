// Выгрузка данных интерактивного калькулятора маршрутов Петербургского метрополитена
// https://metro.spb.ru/map1/route.html (на него ссылается страница «Интерактивная карта»
// https://metro.spb.ru/interactive.html — сама она данных не содержит).
//
// Калькулятор полностью клиентский, серверного API нет. Все данные — в двух статичных файлах:
//   - map1/files/spb00000.js — модель: параметры времени (subwayOptions) и schema-данные
//     (subwayData): 6 линий со станциями и их координатами В ПИКСЕЛЯХ картинки схемы,
//     список пересадок, списки временных закрытий (close/open/obstacles);
//   - map1/route.html — названия станций: список <li> по алфавиту плюс параллельный массив
//     кодов станций в инлайн-вызове stationsList.init([...]). Закрытые станции просто
//     закомментированы и в списке, и в массиве (но в модели графа остаются — поезда их проезжают).
//
// Время перегона сайт НЕ хранит, а вычисляет из геометрии схемы (files/route000.js):
//   время = round(расстояние_px / скорость(расстояние_px)) + stopTime,
//   скорость = trainSpeed[round(расстояние_px / 10)] (пикселей в секунду, дальше — последняя).
// Этот скрипт воспроизводит формулу и сохраняет готовые времена перегонов в edges[].
//
// ВАЖНО (TLS): metro.spb.ru подписан сертификатом «Russian Trusted Root CA» (Минцифры),
// которого нет в комплекте Node.js, — запросы идут через node:https с закреплённым корнем
// (файл russian-trusted-root-ca.pem рядом со скриптом, отпечаток SHA-256 — в README).
//
// Запуск: node fetch-route-map.js
// Сохраняет map1-route.html и map1-spb00000.js (исходники) и spb-route-map.json (разбор).
// Ванильный JavaScript (ESM), без зависимостей. Требуется Node.js 18+.

import { readFile, writeFile } from 'node:fs/promises';
import * as https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const PAGE_URL = 'https://metro.spb.ru/map1/route.html';
const DATA_URL = 'https://metro.spb.ru/map1/files/spb00000.js';

// Сопоставление трёхбуквенных кодов линий сайта с публичными номерами и названиями.
// В файлах сайта названий линий нет (коды различаются только цветом в CSS), поэтому
// сопоставление задано здесь; проверяется по составу станций (см. README).
const LINE_META = {
  kiv: { number: 1, name: 'Кировско-Выборгская' },
  mop: { number: 2, name: 'Московско-Петроградская' },
  nev: { number: 3, name: 'Невско-Василеостровская' },
  prb: { number: 4, name: 'Лахтинско-Правобережная' },
  frp: { number: 5, name: 'Фрунзенско-Приморская' },
  kra: { number: 6, name: 'Красносельско-Калининская' },
};

// ── скачивание с закреплённым корневым сертификатом ──────────────────────────
const ca = await readFile(join(OUT_DIR, 'russian-trusted-root-ca.pem'), 'utf8');
const get = (url) => new Promise((resolve, reject) => {
  const req = https.get(
    url,
    // Accept обязателен: без него WAF сайта отвечает нестандартным кодом 477 (пути /map1/*)
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: '*/*' }, ca, timeout: 45_000 },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} при запросе ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    },
  );
  req.on('timeout', () => req.destroy(new Error(`Тайм-аут при запросе ${url}`)));
  req.on('error', reject);
});

const pageHtml = await get(PAGE_URL);
const dataJs = await get(DATA_URL);
await writeFile(join(OUT_DIR, 'map1-route.html'), pageHtml, 'utf8');
await writeFile(join(OUT_DIR, 'map1-spb00000.js'), dataJs, 'utf8');

// ── выполнение файла данных в песочнице ──────────────────────────────────────
// spb00000.js — обычный скрипт с двумя объявлениями var; выполняем его в функции
// и забираем оба объекта (тот же приём, что в ../spb-metrobook-ru/fetch-data.js).
const sandbox = {};
new Function(`${dataJs}\n;this.subwayOptions = subwayOptions; this.subwayData = subwayData;`).call(sandbox);
const { subwayOptions: options, subwayData: data } = sandbox;
if (!options?.trainSpeed || !data?.lines || !data?.transfers) {
  throw new Error('Структура spb00000.js изменилась: не найдены subwayOptions/subwayData');
}

// ── названия станций из route.html ───────────────────────────────────────────
// Порядок действующих <li> совпадает с порядком кодов в stationsList.init([...]).
// Закомментированные пары (закрытые станции) идут в тех же алфавитных позициях —
// сопоставляем их между собой по порядку появления.
const itemsBlock = pageHtml.match(/<ul class="items">([\s\S]*?)<\/ul>/)?.[1];
const initArr = pageHtml.match(/stationsList\.init\(\[([\s\S]*?)\]\)/)?.[1];
if (!itemsBlock || !initArr) {
  throw new Error('Разметка route.html изменилась: не найден список станций или массив кодов');
}
const liRe = /<li>([^<]+)<\/li>/g;
const commentedTitles = [...itemsBlock.matchAll(/<!--\s*<li>([^<]+)<\/li>\s*-->/g)].map((m) => m[1].trim());
const activeTitles = [...itemsBlock.replace(/<!--[\s\S]*?-->/g, '').matchAll(liRe)].map((m) => m[1].trim());
const idRe = /"([a-z]{3}-[a-z]{3})"/g;
const commentedIds = [...initArr.matchAll(/\/\*\s*"([a-z]{3}-[a-z]{3})"\s*,?\s*\*\//g)].map((m) => m[1]);
const activeIds = [...initArr.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(idRe)].map((m) => m[1]);
if (activeIds.length !== activeTitles.length || commentedIds.length !== commentedTitles.length) {
  throw new Error(
    `Список станций не совпал с массивом кодов (${activeTitles.length} названий и ${activeIds.length} кодов; закомментированных ${commentedTitles.length} и ${commentedIds.length})`,
  );
}
const titleById = new Map(activeIds.map((id, i) => [id, activeTitles[i]]));
commentedIds.forEach((id, i) => titleById.set(id, commentedTitles[i]));

// ── воспроизведение формулы времени перегона (files/route000.js) ─────────────
const speedAt = (distance) => {
  const n = Math.round(distance / 10);
  return options.trainSpeed[n] ?? options.trainSpeed[options.trainSpeed.length - 1];
};
const rideSec = (a, b) => {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.round(distance / speedAt(distance) + options.stopTime);
};

// ── сборка линий, перегонов и параметров пересадок ───────────────────────────
const lines = Object.entries(data.lines).map(([code, items]) => ({
  code,
  ...(LINE_META[code] ?? { number: null, name: null }),
  stations: items.map((s) => ({
    id: `${code}-${s.id}`,
    title: titleById.get(`${code}-${s.id}`) ?? null,
    x: s.x,
    y: s.y,
  })),
}));
const edges = [];
for (const line of lines) {
  for (let i = 0; i + 1 < line.stations.length; i++) {
    const a = line.stations[i];
    const b = line.stations[i + 1];
    edges.push({
      from: a.id,
      to: b.id,
      distancePx: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100) / 100,
      rideSec: rideSec(a, b),
    });
  }
}

// Константы пересадок — так их выводит из subwayOptions движок route000.js
const halfLatency = Math.round(options.trainLatency / 2);
const timing = {
  rideStopSec: options.stopTime,
  rideFaultSec: options.stageFault,
  transferSec: Math.round((options.transferMax + options.transferMin) / 2) + halfLatency,
  transferFaultSec: Math.round((options.transferMax - options.transferMin) / 2) + halfLatency,
  sameLineReverseSec: 20 + halfLatency,
  sameLineReverseFaultSec: halfLatency,
  entranceMinSec: options.entranceMin,
  entranceMaxSec: options.entranceMax,
};

// ── проверка правдоподобия ───────────────────────────────────────────────────
const stationCount = lines.reduce((n, l) => n + l.stations.length, 0);
const titledCount = lines.reduce((n, l) => n + l.stations.filter((s) => s.title).length, 0);
if (lines.length < 5 || stationCount < 70 || titledCount < 70 || data.transfers.length < 16 || edges.length < 60) {
  throw new Error(
    `Извлечённые данные неправдоподобны (${lines.length} линий, ${stationCount} станций, ${titledCount} с названиями, ${data.transfers.length} пересадок, ${edges.length} перегонов) — структура источника изменилась`,
  );
}

const out = {
  source: PAGE_URL,
  dataSource: DATA_URL,
  fetchedAt: new Date().toISOString(),
  options,
  timing,
  lines,
  edges,
  transfers: data.transfers,
  close: data.close,
  open: data.open,
  obstacles: data.obstacles ?? {},
  excludedFromPicker: commentedIds,
};
await writeFile(join(OUT_DIR, 'spb-route-map.json'), JSON.stringify(out, null, 2), 'utf8');

console.log(
  `Готово: линий ${lines.length}, станций ${stationCount} (с названиями ${titledCount}), перегонов ${edges.length}, пересадочных связей ${data.transfers.length}`,
);
console.log(
  `Пересадка ${timing.transferSec}±${timing.transferFaultSec} с, стоянка ${timing.rideStopSec} с, вход/выход ${timing.entranceMinSec}–${timing.entranceMaxSec} с`,
);
for (const id of commentedIds) {
  console.log(`  исключена из выбора (закрыта): ${id} — ${titleById.get(id) ?? 'название неизвестно'}`);
}
