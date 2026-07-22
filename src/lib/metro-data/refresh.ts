// Оркестратор получения данных метро. Каскад источников:
//
//   1. Свежий mosmetro.ru (схема + уведомления)      — полный набор сведений
//   2. Свежий metrobook.ru                            — скудный набор (ядро графа)
//   3. Диск: файлы mosmetro (уведомления — если им меньше 24 часов)
//   4. Диск: файл metrobook
//   5. Ничего нет → dataset = null (кеш пустой, маршрутизация вернёт ошибку)
//
// Правило срока жизни уведомлений: если при обновлении уведомления получить не удалось,
// их файл УДАЛЯЕТСЯ с диска — устаревшие сведения о закрытиях хуже их отсутствия.
// Файл схемы, напротив, не удаляется никогда: станции и перегоны не «протухают».
//
// Все зависимости (хранилище, адреса, fetch, часы, журнал) передаются параметрами —
// модуль не обращается ни к appConfig, ни к fa-mcp-sdk и легко тестируется
// с подменёнными источниками. Журнал логирования передаёт init.ts.

import {
  IMosmetroRawNotifications,
  IMosmetroRawSchema,
  fetchMosmetroNotifications,
  fetchMosmetroSchema,
  normalizeMosmetro,
  validateMosmetroNotifications,
  validateMosmetroSchema,
} from './fetch-mosmetro.js';
import {
  enrichMetrobookFromMosmetroSchema,
  fetchMetrobookGraph,
  normalizeMetrobook,
  validateMetrobookGraph,
} from './fetch-metrobook.js';
import { MetroStorage } from './storage.js';
import { IMetroDataset } from './types.js';

/** Журнал логирования (подмножество, которое использует этот модуль) */
export interface IRefreshLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

/** Журнал по умолчанию — тишина (в проде init.ts передаёт логгер fa-mcp-sdk) */
const SILENT_LOG: IRefreshLog = { info: () => {}, warn: () => {}, error: () => {} };

/** Откуда в итоге взяты данные */
export type TRefreshOrigin = 'mosmetro-fresh' | 'metrobook-fresh' | 'mosmetro-disk' | 'metrobook-disk' | 'none';

export interface IRefreshResult {
  dataset: IMetroDataset | null;
  origin: TRefreshOrigin;
}

export interface IRefreshDeps {
  storage: MetroStorage;
  urls: {
    mosmetroSchema: string;
    mosmetroNotifications: string;
    metrobook: string;
  };
  requestTimeoutMs: number;
  notificationsTtlMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: IRefreshLog;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Чтение лучшего доступного набора данных с диска (без обращений к сети) */
export const loadMetroDataFromDisk = async (deps: IRefreshDeps): Promise<IRefreshResult> => {
  const { storage, notificationsTtlMs } = deps;
  const log = deps.log ?? SILENT_LOG;

  // Приоритет 1: файлы mosmetro
  const schemaRawUnchecked = await storage.read('mosmetroSchema');
  if (schemaRawUnchecked) {
    try {
      const schemaRaw = validateMosmetroSchema(schemaRawUnchecked);
      const schemaMeta = await storage.getFileMeta('mosmetroSchema');

      let notificationsRaw: IMosmetroRawNotifications | null = null;
      let notificationsFetchedAt: string | undefined;
      const notifUnchecked = await storage.readNotificationsFresh(notificationsTtlMs);
      if (notifUnchecked) {
        try {
          notificationsRaw = validateMosmetroNotifications(notifUnchecked);
          notificationsFetchedAt = (await storage.getFileMeta('mosmetroNotifications'))?.fetchedAt;
        } catch (e) {
          log.warn(`Файл уведомлений на диске повреждён, игнорируется: ${errText(e)}`);
        }
      }

      const dataset = normalizeMosmetro(schemaRaw, notificationsRaw, {
        schemaFetchedAt: schemaMeta?.fetchedAt ?? new Date(0).toISOString(),
        ...(notificationsFetchedAt ? { notificationsFetchedAt } : {}),
      });
      return { dataset, origin: 'mosmetro-disk' };
    } catch (e) {
      log.warn(`Файл схемы mosmetro на диске не прошёл проверку структуры: ${errText(e)}`);
    }
  }

  // Приоритет 2: файл metrobook
  const metrobookGraph = await storage.readMetrobookGraph();
  if (metrobookGraph) {
    try {
      validateMetrobookGraph(metrobookGraph);
      return { dataset: normalizeMetrobook(metrobookGraph), origin: 'metrobook-disk' };
    } catch (e) {
      log.warn(`Файл графа metrobook на диске не прошёл проверку структуры: ${errText(e)}`);
    }
  }

  return { dataset: null, origin: 'none' };
};

/**
 * Плановое обновление: скачивает данные по каскаду источников, сохраняет их на диск
 * и возвращает лучший доступный набор данных.
 */
export const refreshMetroData = async (deps: IRefreshDeps): Promise<IRefreshResult> => {
  const { storage, urls, requestTimeoutMs, fetchImpl, now } = deps;
  const log = deps.log ?? SILENT_LOG;
  const nowIso = (): string => (now?.() ?? new Date()).toISOString();
  const fetchOpts = (url: string) => ({
    url,
    timeoutMs: requestTimeoutMs,
    ...(fetchImpl ? { fetchImpl } : {}),
  });

  // ── Шаг 1: основной источник mosmetro.ru ──────────────────────────────────
  let schemaRaw: IMosmetroRawSchema | null = null;
  try {
    schemaRaw = await fetchMosmetroSchema(fetchOpts(urls.mosmetroSchema));
  } catch (e) {
    log.warn(`Схема mosmetro недоступна: ${errText(e)}`);
  }

  // Уведомления пытаемся получить независимо от исхода схемы: даже при недоступной схеме
  // свежие уведомления полезны набору данных, собранному из дисковой копии схемы.
  let notificationsRaw: IMosmetroRawNotifications | null = null;
  let notificationsFetchedAt: string | undefined;
  try {
    notificationsRaw = await fetchMosmetroNotifications(fetchOpts(urls.mosmetroNotifications));
    notificationsFetchedAt = nowIso();
    await storage.write('mosmetroNotifications', notificationsRaw, notificationsFetchedAt);
  } catch (e) {
    // Правило срока жизни: обновить уведомления не удалось — устаревший файл удаляется
    log.warn(`Уведомления mosmetro недоступны, файл устаревших уведомлений удаляется: ${errText(e)}`);
    await storage.delete('mosmetroNotifications');
  }

  if (schemaRaw) {
    const schemaFetchedAt = nowIso();
    await storage.write('mosmetroSchema', schemaRaw, schemaFetchedAt);
    const dataset = normalizeMosmetro(schemaRaw, notificationsRaw, {
      schemaFetchedAt,
      ...(notificationsRaw && notificationsFetchedAt ? { notificationsFetchedAt } : {}),
    });
    log.info(
      `Данные метро обновлены с mosmetro.ru: станций ${dataset.stations.length}, ` +
        `уведомлений ${dataset.notifications?.length ?? 0}`,
    );
    return { dataset, origin: 'mosmetro-fresh' };
  }

  // ── Шаг 2: резервный источник metrobook.ru ────────────────────────────────
  try {
    const graph = await fetchMetrobookGraph({
      url: urls.metrobook,
      timeoutMs: requestTimeoutMs,
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(now ? { now } : {}),
    });
    await storage.write('metrobookGraph', graph, graph.fetchedAt);
    let dataset = normalizeMetrobook(graph);

    // Обогащение из последней сохранённой схемы mosmetro (даже устаревшей):
    // многоязычные названия и «вторые» имена пересадочных узлов для поиска
    const diskSchemaUnchecked = await storage.read('mosmetroSchema');
    if (diskSchemaUnchecked) {
      try {
        dataset = enrichMetrobookFromMosmetroSchema(dataset, validateMosmetroSchema(diskSchemaUnchecked));
      } catch (e) {
        log.warn(`Обогащение metrobook из дисковой схемы mosmetro не удалось: ${errText(e)}`);
      }
    }
    log.info(`Данные метро обновлены с резервного источника metrobook.ru: станций ${dataset.stations.length}`);
    return { dataset, origin: 'metrobook-fresh' };
  } catch (e) {
    log.warn(`Резервный источник metrobook недоступен: ${errText(e)}`);
  }

  // ── Шаг 3–4: дисковые копии ───────────────────────────────────────────────
  const disk = await loadMetroDataFromDisk(deps);
  if (disk.dataset) {
    log.info(`Оба источника недоступны — использована дисковая копия (${disk.origin})`);
    return disk;
  }

  log.error('Данные метро получить не удалось: оба источника недоступны, дисковых копий нет');
  return { dataset: null, origin: 'none' };
};
