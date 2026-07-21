// Скрипт выгрузки данных Московского метрополитена для автономного использования.
//
// Всего ДВА запроса к серверу:
//   1. https://prodapp.mosmetro.ru/api/schema/v1.0      — полная схема: станции, линии, перегоны, переходы.
//      Меняется редко (при открытии новых станций) — достаточно обновлять раз в неделю-месяц.
//   2. https://prodapp.mosmetro.ru/api/notifications/v2 — закрытия и ремонты.
//      Меняется чаще — рекомендуется обновлять раз в сутки или перед построением маршрута.
//
// Запуск:  node fetch-data.js [--schema-only | --notifications-only]
// Файлы сохраняются рядом со скриптом: schema-v1.0.json и notifications-v2.json.
//
// Ванильный JavaScript (ESM), без зависимостей. Требуется Node.js 18+ (встроенный fetch).

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

const SOURCES = {
  schema: {
    url: 'https://prodapp.mosmetro.ru/api/schema/v1.0',
    file: 'schema-v1.0.json',
  },
  notifications: {
    url: 'https://prodapp.mosmetro.ru/api/notifications/v2',
    file: 'notifications-v2.json',
  },
};

async function download({ url, file }) {
  const res = await fetch(url, {
    headers: {
      // Без правдоподобного User-Agent сервер может отдавать ошибку или отклонять запросы
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} при запросе ${url}`);
  }
  const json = await res.json();
  if (json.success === false) {
    throw new Error(`Сервер вернул success=false при запросе ${url}`);
  }
  const path = join(OUT_DIR, file);
  await writeFile(path, JSON.stringify(json), 'utf8');
  console.log(`Сохранено: ${path}`);
  return json;
}

const arg = process.argv[2];
const tasks = [];
if (arg !== '--notifications-only') {
  tasks.push(SOURCES.schema);
}
if (arg !== '--schema-only') {
  tasks.push(SOURCES.notifications);
}

for (const src of tasks) {
  await download(src);
}
console.log('Готово.');
