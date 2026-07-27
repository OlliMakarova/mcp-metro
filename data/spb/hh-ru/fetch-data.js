// Выгрузка справочника метро Санкт-Петербурга из открытого API HeadHunter.
//
// Всего ОДИН запрос: GET https://api.hh.ru/metro/2  (2 — идентификатор Санкт-Петербурга
// в справочнике регионов hh.ru; Москва — 1; список городов с метро: GET https://api.hh.ru/metro/).
//
// API открытое и документированное (https://api.hh.ru/openapi/redoc#tag/Obshie-spravochniki),
// авторизация не требуется, достаточно любого User-Agent.
//
// Ответ содержит линии метро с названиями и цветами и станции с координатами и порядковым
// номером на линии. Времён перегонов и пересадок в справочнике НЕТ — он используется как
// источник обогащения (координаты, имена и цвета линий) поверх графа spb.metrobook.ru.
//
// Запуск: node fetch-data.js
// Файл сохраняется рядом со скриптом: hh-metro-spb.json.
// Ванильный JavaScript (ESM), без зависимостей. Требуется Node.js 18+.

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const URL = 'https://api.hh.ru/metro/2';

const res = await fetch(URL, {
  headers: { 'User-Agent': 'metro-research/1.0', Accept: 'application/json' },
});
if (!res.ok) {
  throw new Error(`HTTP ${res.status} ${res.statusText} при запросе ${URL}`);
}
const data = await res.json();

// ── проверка правдоподобия ───────────────────────────────────────────────────
if (!Array.isArray(data.lines) || data.lines.length < 5) {
  throw new Error('Ответ не похож на справочник метро СПб: ожидается не меньше 5 линий');
}
const stations = data.lines.flatMap((l) => l.stations ?? []);
const located = stations.filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lng));
if (stations.length < 60 || located.length < 60) {
  throw new Error(`Справочник неправдоподобен: станций ${stations.length}, с координатами ${located.length}`);
}

await writeFile(join(OUT_DIR, 'hh-metro-spb.json'), JSON.stringify(data, null, 2), 'utf8');
console.log(`Готово: город «${data.name}», линий ${data.lines.length}, станций ${stations.length}`);
for (const l of data.lines) {
  console.log(`  линия ${l.id} «${l.name}» (#${l.hex_color}): ${l.stations.length} станций`);
}
