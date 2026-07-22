import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Tool definitions of the metro MCP server.
 *
 * Schemas conform to JSON Schema draft 2020-12 (`$schema`) and forbid unknown fields
 * (`additionalProperties: false`) — a requirement of the standard, §9.2.
 */

export const tools: Tool[] = [
  {
    name: 'mos_metro_info',
    title: 'Московское метро: маршруты и сведения о станциях',
    description: `Поиск маршрутов между двумя станциями Московского метрополитена (включая МЦК и МЦД) и выдача сведений о станции.
В режиме search_route строит от 1 до 4 кратчайших маршрутов между двумя станциями с полным временем в пути, станциями, пересадками, рекомендациями по вагонам, наземным транспортом на конечных станциях и действующими ограничениями (ремонты, закрытия). 
В режиме get_station_info возвращает сведения о станции: линии, выходы, наземный транспорт, услуги, расписание первых и последних поездов, пересадки и предупреждения. 

Названия станций можно передавать так как их укажет пользователь.
`,
    inputSchema: {
      type: 'object',
      properties: {
        first_metro_station: {
          type: 'string',
          description: `Название станции отправления (для search_route) или станции, о которой нужны сведения (для get_station_info).`,
        },
        second_metro_station: {
          type: 'string',
          description: `Название станции прибытия. Обязательно только для action=search_route.`,
        },
        action: {
          type: 'string',
          enum: ['search_route', 'get_station_info'],
          description: `Тип действия: "search_route" — построить кратчайшие маршруты между двумя станциями; 
"get_station_info" — вернуть сведения о станции first_metro_station.`,
        },
      },
      required: ['first_metro_station', 'action'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
];
