import { IPromptData } from 'fa-mcp-sdk';

/**
 * Дополнительные пользовательские промпты MCP-сервера.
 *
 * Для сервера метро отдельные пользовательские промпты не требуются: поведение агента задаёт
 * AGENT_PROMPT, а подсказки по инструменту — tool-prompts.ts. Массив оставлен пустым намеренно.
 */
export const customPrompts: IPromptData[] = [];
