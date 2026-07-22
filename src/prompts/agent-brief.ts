/**
 * Level 1: brief agent description.
 * Used by the agent router when picking a suitable agent from the list for a user request.
 * At this level the model does not yet see the tools.
 */

export const AGENT_BRIEF = `Помощник по Московскому метрополитену (включая МЦК и МЦД): 
строит кратчайшие маршруты между станциями с временем в пути, пересадками и наземным транспортом, 
а также выдаёт исчерпывающие сведения о станциях (выходы, услуги, расписание первых и последних поездов, ремонты и закрытия). 
Понимает названия станций на русском, английском, арабском и китайском языках, в том числе с опечатками.`;
