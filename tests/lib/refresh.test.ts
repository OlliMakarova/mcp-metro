// Тесты каскада источников и правил хранения на диске:
//   свежий mosmetro → свежий metrobook → диск (mosmetro приоритетнее metrobook) → пусто;
//   срок жизни уведомлений 24 часа; атомарность и целостность файлов при сбоях.
// Сеть подменяется фиктивным fetch, диск — временной папкой.

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { MetroStorage, STORAGE_FILES } from '../../src/lib/metro-data/storage.js';
import { IRefreshDeps, loadMetroDataFromDisk, refreshMetroData } from '../../src/lib/metro-data/refresh.js';
import { loadMetrobookHtml, loadNotificationsRaw, loadSchemaRaw } from './helpers.js';

const URLS = {
  mosmetroSchema: 'https://test.local/schema',
  mosmetroNotifications: 'https://test.local/notifications',
  metrobook: 'https://test.local/metrobook',
};

const TTL_MS = 24 * 3_600_000;

/** Ответ, похожий на Response, — ровно те поля, которые использует код скачивания */
const httpResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status < 400,
    status,
    statusText: `HTTP_${status}`,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as unknown as Response;

type TRoute = 'schema' | 'notifications' | 'metrobook';

/** Фиктивный fetch: для каждого маршрута задаётся тело ответа, код ошибки или обрыв сети */
const makeFetch = (routes: Partial<Record<TRoute, unknown | { fail: number | 'network' }>>): typeof fetch =>
  (async (input: unknown) => {
    const url = String(input);
    const route: TRoute = url.includes('notifications')
      ? 'notifications'
      : url.includes('schema')
        ? 'schema'
        : 'metrobook';
    const conf = routes[route];
    if (conf === undefined) {
      throw new Error(`Сеть недоступна (маршрут ${route} не настроен)`);
    }
    if (conf && typeof conf === 'object' && 'fail' in conf) {
      const { fail } = conf as { fail: number | 'network' };
      if (fail === 'network') {
        throw new Error('Обрыв сети');
      }
      return httpResponse('', fail);
    }
    return httpResponse(conf);
  }) as typeof fetch;

describe('Каскад источников и дисковый кеш', () => {
  let dir: string;
  let storage: MetroStorage;

  const deps = (fetchImpl: typeof fetch, extra: Partial<IRefreshDeps> = {}): IRefreshDeps => ({
    storage,
    urls: URLS,
    requestTimeoutMs: 5_000,
    notificationsTtlMs: TTL_MS,
    fetchImpl,
    ...extra,
  });

  const allOkFetch = (): typeof fetch =>
    makeFetch({ schema: loadSchemaRaw(), notifications: loadNotificationsRaw(), metrobook: loadMetrobookHtml() });

  const allFailFetch = (): typeof fetch =>
    makeFetch({ schema: { fail: 'network' }, notifications: { fail: 'network' }, metrobook: { fail: 'network' } });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'metro-test-'));
    storage = new MetroStorage(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const fileExists = (key: keyof typeof STORAGE_FILES): boolean => existsSync(path.join(dir, STORAGE_FILES[key]));

  test('оба запроса mosmetro успешны → полный набор, файлы записаны', async () => {
    const res = await refreshMetroData(deps(allOkFetch()));
    expect(res.origin).toBe('mosmetro-fresh');
    expect(res.dataset?.source).toBe('mosmetro');
    expect(res.dataset?.stations.length).toBe(443);
    expect(res.dataset?.notifications?.length).toBe(92);
    expect(fileExists('mosmetroSchema')).toBe(true);
    expect(fileExists('mosmetroNotifications')).toBe(true);
    expect(fileExists('meta')).toBe(true);
  });

  test('схема mosmetro недоступна → данные с metrobook, файл уведомлений удалён', async () => {
    // Заранее кладём «вчерашние» уведомления — они должны удалиться по правилу срока жизни
    await storage.write('mosmetroNotifications', loadNotificationsRaw());
    const res = await refreshMetroData(
      deps(makeFetch({ schema: { fail: 500 }, notifications: { fail: 500 }, metrobook: loadMetrobookHtml() })),
    );
    expect(res.origin).toBe('metrobook-fresh');
    expect(res.dataset?.source).toBe('metrobook');
    expect(res.dataset?.notifications).toBeUndefined();
    expect(fileExists('metrobookGraph')).toBe(true);
    expect(fileExists('mosmetroNotifications')).toBe(false); // правило TTL
  });

  test('свежий metrobook обогащается из дисковой схемы mosmetro', async () => {
    // Первый запуск: mosmetro успешен, схема сохранена на диск
    await refreshMetroData(deps(allOkFetch()));
    // Второй запуск: mosmetro упал, metrobook жив — названия подтягиваются из дисковой схемы
    const res = await refreshMetroData(
      deps(
        makeFetch({ schema: { fail: 'network' }, notifications: { fail: 'network' }, metrobook: loadMetrobookHtml() }),
      ),
    );
    expect(res.origin).toBe('metrobook-fresh');
    const hovrino = res.dataset?.stations.find((s) => s.name.ru === 'Ховрино');
    expect(hovrino?.name.en).toBe('Khovrino');
  });

  test('оба источника недоступны → дисковая копия mosmetro (без устаревших уведомлений)', async () => {
    await refreshMetroData(deps(allOkFetch()));
    const res = await refreshMetroData(deps(allFailFetch()));
    expect(res.origin).toBe('mosmetro-disk');
    expect(res.dataset?.source).toBe('mosmetro');
    expect(res.dataset?.stations.length).toBe(443);
    // Уведомления не обновились — файл удалён по правилу срока жизни, закрытия не применяются
    expect(res.dataset?.notifications).toBeUndefined();
    expect(fileExists('mosmetroNotifications')).toBe(false);
    // Схема с диска не удаляется никогда
    expect(fileExists('mosmetroSchema')).toBe(true);
  });

  test('на диске только metrobook → дисковая копия metrobook', async () => {
    await refreshMetroData(
      deps(
        makeFetch({ schema: { fail: 'network' }, notifications: { fail: 'network' }, metrobook: loadMetrobookHtml() }),
      ),
    );
    const res = await refreshMetroData(deps(allFailFetch()));
    expect(res.origin).toBe('metrobook-disk');
    expect(res.dataset?.source).toBe('metrobook');
  });

  test('всё недоступно и диск пуст → dataset null (кеш пустой)', async () => {
    const res = await refreshMetroData(deps(allFailFetch()));
    expect(res.origin).toBe('none');
    expect(res.dataset).toBeNull();
  });

  test('схема успешна, уведомления упали → набор без закрытий, файл уведомлений удалён', async () => {
    await refreshMetroData(deps(allOkFetch()));
    const res = await refreshMetroData(deps(makeFetch({ schema: loadSchemaRaw(), notifications: { fail: 503 } })));
    expect(res.origin).toBe('mosmetro-fresh');
    expect(res.dataset?.notifications).toBeUndefined();
    expect(fileExists('mosmetroNotifications')).toBe(false);
  });

  test('невалидный ответ схемы → каскад на metrobook, старый файл схемы не затёрт', async () => {
    await refreshMetroData(deps(allOkFetch()));
    const res = await refreshMetroData(
      deps(
        makeFetch({
          schema: { success: true, data: { stations: [], lines: [], connections: [], transitions: [] } },
          notifications: loadNotificationsRaw(),
          metrobook: loadMetrobookHtml(),
        }),
      ),
    );
    expect(res.origin).toBe('metrobook-fresh');
    // Старая валидная схема на диске цела
    const disk = await loadMetroDataFromDisk(deps(allFailFetch()));
    expect(disk.origin).toBe('mosmetro-disk');
    expect(disk.dataset?.stations.length).toBe(443);
  });

  test('устаревшие уведомления (старше 24 часов) игнорируются при чтении с диска и удаляются', async () => {
    // Пишем уведомления «два дня назад» через хранилище с подменёнными часами
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3_600_000);
    const oldStorage = new MetroStorage(dir, () => twoDaysAgo);
    await oldStorage.write('mosmetroSchema', loadSchemaRaw());
    await oldStorage.write('mosmetroNotifications', loadNotificationsRaw());

    const disk = await loadMetroDataFromDisk(deps(allFailFetch()));
    expect(disk.origin).toBe('mosmetro-disk');
    expect(disk.dataset?.notifications).toBeUndefined();
    expect(fileExists('mosmetroNotifications')).toBe(false); // устаревший файл удалён
  });

  test('свежие уведомления с диска применяются', async () => {
    await refreshMetroData(deps(allOkFetch()));
    const disk = await loadMetroDataFromDisk(deps(allFailFetch()));
    expect(disk.origin).toBe('mosmetro-disk');
    expect(disk.dataset?.notifications?.length).toBe(92);
  });
});
