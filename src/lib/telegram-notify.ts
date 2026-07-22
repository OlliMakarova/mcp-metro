// Отправка оповещений в Telegram через Bot API — один HTTP-запрос sendMessage,
// без внешних библиотек. Модуль чистый и тестируемый: fetch и тайм-аут передаются
// параметрами, ошибки отправки НИКОГДА не пробрасываются наружу (оповещение не должно
// ломать основную работу) — функция просто возвращает false, а причину пишет через
// переданный обработчик onError.

export interface ITelegramConfig {
  /** Выключатель: false или пустые токен/чат — отправка тихо пропускается */
  enabled: boolean;
  /** Токен бота от @BotFather (секрет — хранить в config/local.yaml или ENV) */
  botToken: string;
  /** Идентификатор чата: личный, группа или канал, куда добавлен бот */
  chatId: string;
}

export interface ITelegramSendOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Куда сообщить о неудачной отправке (обычно logger.warn) */
  onError?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Проверка, что оповещения настроены и включены */
export const isTelegramConfigured = (cfg: ITelegramConfig | null | undefined): cfg is ITelegramConfig =>
  !!cfg && cfg.enabled && !!cfg.botToken && !!cfg.chatId;

/**
 * Отправляет текстовое сообщение в Telegram. Возвращает true при успехе.
 * Не бросает исключений: любая ошибка (сеть, тайм-аут, ответ ok=false) приводит
 * к false и вызову onError с описанием причины.
 */
export const sendTelegramMessage = async (
  cfg: ITelegramConfig,
  text: string,
  opts: ITelegramSendOpts = {},
): Promise<boolean> => {
  const { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, onError } = opts;

  if (!isTelegramConfigured(cfg)) {
    return false;
  }

  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      onError?.(`Telegram ответил HTTP ${res.status}: ${body.slice(0, 300)}`);
      return false;
    }
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (json.ok !== true) {
      onError?.(`Telegram отклонил сообщение: ${json.description ?? JSON.stringify(json).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    onError?.(`Не удалось отправить сообщение в Telegram: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
};
