// Sending notifications to Telegram via the Bot API — a single sendMessage HTTP request,
// no external libraries. The module is pure and testable: fetch and the timeout are passed
// as parameters, and send errors are NEVER propagated (a notification must not break the
// main flow) — the function simply returns false and reports the cause via the provided
// onError handler.

export interface ITelegramConfig {
  /** Kill switch: false or empty token/chat — sending is silently skipped */
  enabled: boolean;
  /** Bot token from @BotFather (a secret — keep in config/local.yaml or ENV) */
  botToken: string;
  /** Chat id: personal chat, group or channel the bot was added to */
  chatId: string;
}

export interface ITelegramSendOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Where to report a failed send (usually logger.warn) */
  onError?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Checks that notifications are configured and enabled */
export const isTelegramConfigured = (cfg: ITelegramConfig | null | undefined): cfg is ITelegramConfig =>
  !!cfg && cfg.enabled && !!cfg.botToken && !!cfg.chatId;

/**
 * Sends a text message to Telegram. Returns true on success.
 * Never throws: any error (network, timeout, ok=false response) results in false
 * and a call to onError with the cause description.
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
      onError?.(`Telegram responded with HTTP ${res.status}: ${body.slice(0, 300)}`);
      return false;
    }
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (json.ok !== true) {
      onError?.(`Telegram rejected the message: ${json.description ?? JSON.stringify(json).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    onError?.(`Failed to send Telegram message: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
};
