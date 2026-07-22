import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { IToolInputSchema } from 'fa-mcp-sdk';

/**
 * Tool definitions of the metro MCP server.
 *
 * Schemas conform to JSON Schema draft 2020-12 (`$schema`) and forbid unknown fields
 * (`additionalProperties: false`) — a requirement of the standard, §9.2.
 */

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

const mosMetroInfoInputSchema: IToolInputSchema = {
  $schema: JSON_SCHEMA_2020_12,
  type: 'object',
  properties: {
    first_metro_station: {
      type: 'string',
      description: `Название станции отправления (для search_route) или станции, о которой нужны сведения (для get_station_info). 
Можно передавать на русском, английском, арабском или китайском языке, 
допускаются опечатки и транслитерация — выполняется неточный поиск.`,
    },
    second_metro_station: {
      type: 'string',
      description: `Название станции прибытия. Обязательно для action=search_route. 
Для get_station_info не используется. 
Правила распознавания те же, что и для first_metro_station.`,
    },
    action: {
      type: 'string',
      enum: ['search_route', 'get_station_info'],
      description: `Тип действия: "search_route" — построить кратчайшие маршруты между двумя станциями; 
"get_station_info" — вернуть исчерпывающие сведения о станции first_metro_station.`,
    },
  },
  required: ['first_metro_station', 'action'],
  additionalProperties: false,
};

export const tools: Tool[] = [
  {
    name: 'mos_metro_info',
    title: 'Московское метро: маршруты и сведения о станциях',
    description: `Универсальный инструмент по Московскому метрополитену (включая МЦК и МЦД).
В режиме search_route строит от 1 до 4 кратчайших маршрутов между двумя станциями с полным временем в пути, 
станциями, пересадками, рекомендациями по вагонам, наземным транспортом на конечных станциях 
и действующими ограничениями (ремонты, закрытия). 
В режиме get_station_info возвращает исчерпывающие сведения о станции: 
линии, выходы, наземный транспорт, услуги, расписание первых и последних поездов, пересадки и предупреждения. 
Названия станций ищутся неточно на четырёх языках; 
при неоднозначности инструмент просит уточнить выбор.`,
    inputSchema: mosMetroInfoInputSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
];

/** Tool by name */
export const getToolByName = (name: string): Tool | undefined => tools.find((tool) => tool.name === name);

/** Names of all tools */
export const getToolNames = (): string[] => tools.map((tool) => tool.name);
