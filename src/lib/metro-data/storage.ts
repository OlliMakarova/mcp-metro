// Дисковый кеш скачанных данных метро.
//
// Состав папки (dataDir, вне контроля версий):
//   mosmetro-schema.json         — схема метро; живёт вечно, пока не заменена свежей версией
//   mosmetro-notifications.json  — закрытия/ремонты; срок жизни 24 часа (см. deleteNotifications)
//   metrobook-graph.json         — нормализованный граф резервного источника; живёт вечно
//   meta.json                    — { files: { <имя>: { fetchedAt, bytes, sha256 } } }
//
// Запись атомарная: сначала во временный файл, затем переименование, чтобы при падении
// процесса на диске не оказался наполовину записанный JSON.

import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { IMetrobookGraphFile } from './types.js';

export const STORAGE_FILES = {
  mosmetroSchema: 'mosmetro-schema.json',
  mosmetroNotifications: 'mosmetro-notifications.json',
  metrobookGraph: 'metrobook-graph.json',
  meta: 'meta.json',
} as const;

export type TStorageFileKey = Exclude<keyof typeof STORAGE_FILES, 'meta'>;

export interface IStorageFileMeta {
  /** Когда файл был скачан (ISO UTC) */
  fetchedAt: string;
  bytes: number;
  sha256: string;
}

interface IStorageMeta {
  files: Partial<Record<TStorageFileKey, IStorageFileMeta>>;
}

export class MetroStorage {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private filePath(key: TStorageFileKey | 'meta'): string {
    return path.join(this.dir, STORAGE_FILES[key]);
  }

  private async readMeta(): Promise<IStorageMeta> {
    const raw = await this.readJsonFile(this.filePath('meta'));
    if (raw && typeof raw === 'object' && 'files' in raw) {
      return raw as IStorageMeta;
    }
    return { files: {} };
  }

  private async writeMeta(meta: IStorageMeta): Promise<void> {
    await this.writeFileAtomic(this.filePath('meta'), JSON.stringify(meta, null, 2));
  }

  private async readJsonFile(fullPath: string): Promise<unknown | null> {
    try {
      const text = await fsp.readFile(fullPath, 'utf8');
      return JSON.parse(text);
    } catch {
      // Файла нет или он повреждён — для читающего кода это равнозначно «данных нет»
      return null;
    }
  }

  private async writeFileAtomic(fullPath: string, content: string): Promise<void> {
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    const tmpPath = `${fullPath}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(tmpPath, content, 'utf8');
    await fsp.rename(tmpPath, fullPath);
  }

  /** Читает файл данных; вернёт null, если файла нет или он не разбирается как JSON */
  async read(key: TStorageFileKey): Promise<unknown | null> {
    return this.readJsonFile(this.filePath(key));
  }

  /** Атомарно пишет файл данных и обновляет метаданные (fetchedAt, размер, контрольная сумма) */
  async write(key: TStorageFileKey, json: unknown, fetchedAt?: string): Promise<void> {
    const content = JSON.stringify(json);
    await this.writeFileAtomic(this.filePath(key), content);
    const meta = await this.readMeta();
    meta.files[key] = {
      fetchedAt: fetchedAt ?? this.now().toISOString(),
      bytes: Buffer.byteLength(content, 'utf8'),
      sha256: createHash('sha256').update(content).digest('hex'),
    };
    await this.writeMeta(meta);
  }

  /** Метаданные файла (когда скачан) или null, если файл ещё не записывался */
  async getFileMeta(key: TStorageFileKey): Promise<IStorageFileMeta | null> {
    const meta = await this.readMeta();
    return meta.files[key] ?? null;
  }

  /** Удаляет файл данных и его метаданные (используется для устаревших уведомлений) */
  async delete(key: TStorageFileKey): Promise<void> {
    try {
      await fsp.unlink(this.filePath(key));
    } catch {
      // файла и так нет — это не ошибка
    }
    const meta = await this.readMeta();
    if (meta.files[key]) {
      delete meta.files[key];
      await this.writeMeta(meta);
    }
  }

  /**
   * Читает уведомления с диска с проверкой срока жизни: если файл старше ttlMs,
   * он удаляется и возвращается null — устаревшие сведения о закрытиях опаснее их отсутствия.
   */
  async readNotificationsFresh(ttlMs: number): Promise<unknown | null> {
    const meta = await this.getFileMeta('mosmetroNotifications');
    if (!meta) {
      // Файл без метаданных не считаем доверенным — возраст неизвестен
      await this.delete('mosmetroNotifications');
      return null;
    }
    const age = this.now().getTime() - new Date(meta.fetchedAt).getTime();
    if (!(age >= 0 && age <= ttlMs)) {
      await this.delete('mosmetroNotifications');
      return null;
    }
    return this.read('mosmetroNotifications');
  }

  /** Типизированное чтение сохранённого графа metrobook */
  async readMetrobookGraph(): Promise<IMetrobookGraphFile | null> {
    const raw = await this.read('metrobookGraph');
    if (raw && typeof raw === 'object' && 'stationInstances' in raw && 'edges' in raw) {
      return raw as IMetrobookGraphFile;
    }
    return null;
  }
}
