// Тесты оповещений в Telegram: отправка через подменённый fetch (без сети),
// поведение при ошибках и логика сообщений о смене состояния источников.

import { describe, expect, test } from '@jest/globals';
import { isTelegramConfigured, sendTelegramMessage } from '../../src/lib/telegram-notify.js';
import { buildStateChangeMessage, stateFromOrigin } from '../../src/lib/metro-data/source-state.js';
import { getMetrobookDataset, getMosmetroDataset } from './helpers.js';

const CFG = { enabled: true, botToken: 'TOKEN123', chatId: '42' };

/** Подменённый fetch, запоминающий запрос и возвращающий заданный ответ */
const makeFetch = (
  reply: { status?: number; body?: unknown } | 'network',
): { fetchImpl: typeof fetch; calls: Array<{ url: string; body: any }> } => {
  const calls: Array<{ url: string; body: any }> = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    if (reply === 'network') {
      throw new Error('Обрыв сети');
    }
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    const status = reply.status ?? 200;
    return {
      ok: status < 400,
      status,
      statusText: `HTTP_${status}`,
      json: async () => reply.body ?? { ok: true },
      text: async () => JSON.stringify(reply.body ?? { ok: true }),
    } as unknown as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
};

describe('Отправка в Telegram', () => {
  test('успешная отправка: правильный адрес, chat_id и текст', async () => {
    const { fetchImpl, calls } = makeFetch({ body: { ok: true } });
    const sent = await sendTelegramMessage(CFG, 'Привет', { fetchImpl });
    expect(sent).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.telegram.org/botTOKEN123/sendMessage');
    expect(calls[0]!.body.chat_id).toBe('42');
    expect(calls[0]!.body.text).toBe('Привет');
  });

  test('HTTP-ошибка → false и сообщение в onError, исключение не бросается', async () => {
    const { fetchImpl } = makeFetch({ status: 403, body: { ok: false, description: 'bot was blocked' } });
    const errors: string[] = [];
    const sent = await sendTelegramMessage(CFG, 'x', { fetchImpl, onError: (m) => errors.push(m) });
    expect(sent).toBe(false);
    expect(errors.join(' ')).toContain('403');
  });

  test('ответ ok=false → false и описание причины', async () => {
    const { fetchImpl } = makeFetch({ body: { ok: false, description: 'chat not found' } });
    const errors: string[] = [];
    const sent = await sendTelegramMessage(CFG, 'x', { fetchImpl, onError: (m) => errors.push(m) });
    expect(sent).toBe(false);
    expect(errors.join(' ')).toContain('chat not found');
  });

  test('обрыв сети → false, исключение не бросается', async () => {
    const { fetchImpl } = makeFetch('network');
    const errors: string[] = [];
    const sent = await sendTelegramMessage(CFG, 'x', { fetchImpl, onError: (m) => errors.push(m) });
    expect(sent).toBe(false);
    expect(errors.length).toBe(1);
  });

  test('выключенная или незаполненная конфигурация — отправки нет', async () => {
    const { fetchImpl, calls } = makeFetch({ body: { ok: true } });
    expect(await sendTelegramMessage({ ...CFG, enabled: false }, 'x', { fetchImpl })).toBe(false);
    expect(await sendTelegramMessage({ ...CFG, botToken: '' }, 'x', { fetchImpl })).toBe(false);
    expect(await sendTelegramMessage({ ...CFG, chatId: '' }, 'x', { fetchImpl })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test('isTelegramConfigured', () => {
    expect(isTelegramConfigured(CFG)).toBe(true);
    expect(isTelegramConfigured({ ...CFG, enabled: false })).toBe(false);
    expect(isTelegramConfigured(null)).toBe(false);
  });
});

describe('Состояние источников и тексты оповещений', () => {
  test('соответствие origin → состояние', () => {
    expect(stateFromOrigin('mosmetro-fresh')).toBe('ok');
    expect(stateFromOrigin('metrobook-fresh')).toBe('backup');
    expect(stateFromOrigin('mosmetro-disk')).toBe('disk');
    expect(stateFromOrigin('metrobook-disk')).toBe('disk');
    expect(stateFromOrigin('none')).toBe('none');
  });

  test('без смены состояния сообщения нет', () => {
    expect(buildStateChangeMessage('svc', 'ok', 'ok', getMosmetroDataset())).toBeNull();
    expect(buildStateChangeMessage('svc', 'none', 'none', null)).toBeNull();
  });

  test('ухудшение: понятные тексты с именем сервиса', () => {
    const backup = buildStateChangeMessage('mcp-metro', 'ok', 'backup', getMetrobookDataset());
    expect(backup).toContain('mcp-metro');
    expect(backup).toContain('mosmetro.ru недоступен');
    expect(backup).toContain('metrobook.ru');

    const disk = buildStateChangeMessage('mcp-metro', 'backup', 'disk', getMosmetroDataset());
    expect(disk).toContain('дисковая копия');
    expect(disk).toContain('2026-07-22');

    const none = buildStateChangeMessage('mcp-metro', 'disk', 'none', null);
    expect(none).toContain('дисковой копии нет');
  });

  test('восстановление: сообщение о возврате к полным данным', () => {
    const ok = buildStateChangeMessage('mcp-metro', 'disk', 'ok', getMosmetroDataset());
    expect(ok).toContain('снова доступен');
  });
});
