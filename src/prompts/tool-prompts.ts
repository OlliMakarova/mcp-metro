import { TPromptContentFunction } from 'fa-mcp-sdk';

/**
 * Per-tool hints served by the built-in `tool_prompt` prompt.
 *
 * The `tool_prompt` prompt is always declared in MCP, but returns a non-empty string only
 * for the tools listed here. The client passes the tool name in the required `tool` argument.
 */
const TOOL_PROMPTS: Record<string, string> = {
  mos_metro_info: `Инструмент "mos_metro_info" отвечает на два вида запросов по Московскому метро (метро, МЦК, МЦД).

Параметры:
- first_metro_station (обязательный) — станция отправления или станция, о которой нужны сведения.
- second_metro_station — станция прибытия; указывай только для action="search_route".
- action (обязательный) — "search_route" для маршрута, "get_station_info" для сведений о станции.

Как пользоваться:
- Для маршрута задай action="search_route" и обе станции. В ответе придёт от 1 до 4 вариантов с полным
  временем в пути, станциями, пересадками, рекомендациями по вагонам, наземным транспортом на конечных
  станциях и действующими ограничениями (ремонты, закрытия).
- Для сведений о станции задай action="get_station_info" и укажи станцию в first_metro_station.
- Названия передавай как есть (любой из четырёх языков, опечатки допустимы) — поиск неточный.
- Если в ответе просьба уточнить станцию со списком вариантов, покажи список пользователю и вызови
  инструмент снова с выбранным названием. Ответ всегда в формате markdown — сохраняй его структуру.`,
};

export const toolPrompt: TPromptContentFunction = (_request, args) => {
  const tool = args?.tool;
  if (!tool) {
    return '';
  }
  return TOOL_PROMPTS[tool] ?? '';
};
