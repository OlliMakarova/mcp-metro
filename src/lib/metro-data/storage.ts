// Disk cache of downloaded metro data.
//
// Folder contents (dataDir, not under version control):
//   mosmetro-schema.json         — metro schema; lives forever until replaced by a fresh version
//   mosmetro-notifications.json  — closures/repairs; 24-hour time-to-live (see deleteNotifications)
//   metrobook-graph.json         — normalized graph of the backup source; lives forever
//   meta.json                    — { files: { <name>: { fetchedAt, bytes, sha256 } } }
//
// Writes are atomic: first to a temporary file, then rename, so that a process crash
// never leaves a half-written JSON on disk.

import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { IMetrobookGraphFile } from './types.js';

export const STORAGE_FILES = {
  mosmetroSchema: 'mosmetro-schema.json',
  mosmetroNotifications: 'mosmetro-notifications.json',
  metrobookGraph: 'metrobook-graph.json',
  spbMetrobookGraph: 'spb-metrobook-graph.json',
  spbHhMetro: 'spb-hh-metro.json',
  spbOfficialHours: 'spb-official-hours.json',
  meta: 'meta.json',
} as const;

export type TStorageFileKey = Exclude<keyof typeof STORAGE_FILES, 'meta'>;

export interface IStorageFileMeta {
  /** When the file was downloaded (ISO UTC) */
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
      // File is missing or corrupted — for the reading code this is the same as "no data"
      return null;
    }
  }

  private async writeFileAtomic(fullPath: string, content: string): Promise<void> {
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    const tmpPath = `${fullPath}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(tmpPath, content, 'utf8');
    await fsp.rename(tmpPath, fullPath);
  }

  /** Reads a data file; returns null if the file is missing or does not parse as JSON */
  async read(key: TStorageFileKey): Promise<unknown | null> {
    return this.readJsonFile(this.filePath(key));
  }

  /** Atomically writes a data file and updates its metadata (fetchedAt, size, checksum) */
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

  /** File metadata (when it was downloaded) or null if the file has never been written */
  async getFileMeta(key: TStorageFileKey): Promise<IStorageFileMeta | null> {
    const meta = await this.readMeta();
    return meta.files[key] ?? null;
  }

  /** Deletes a data file and its metadata (used for stale notifications) */
  async delete(key: TStorageFileKey): Promise<void> {
    try {
      await fsp.unlink(this.filePath(key));
    } catch {
      // the file is already gone — not an error
    }
    const meta = await this.readMeta();
    if (meta.files[key]) {
      delete meta.files[key];
      await this.writeMeta(meta);
    }
  }

  /**
   * Reads notifications from disk with a time-to-live check: if the file is older than ttlMs,
   * it is deleted and null is returned — stale closure information is more dangerous than none.
   */
  async readNotificationsFresh(ttlMs: number): Promise<unknown | null> {
    const meta = await this.getFileMeta('mosmetroNotifications');
    if (!meta) {
      // A file without metadata is not trusted — its age is unknown
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

  /** Typed read of a saved metrobook-format graph (Moscow fallback or the SPb graph source) */
  async readMetrobookGraph(
    key: 'metrobookGraph' | 'spbMetrobookGraph' = 'metrobookGraph',
  ): Promise<IMetrobookGraphFile | null> {
    const raw = await this.read(key);
    if (raw && typeof raw === 'object' && 'stationInstances' in raw && 'edges' in raw) {
      return raw as IMetrobookGraphFile;
    }
    return null;
  }
}
