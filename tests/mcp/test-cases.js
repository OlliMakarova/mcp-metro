#!/usr/bin/env node

/**
 * Shared test cases for the metro MCP server (run over the STDIO, HTTP and SSE transports).
 * They cover prompts, resources and the mos_metro_info tool.
 *
 * Each test is a function(client) -> Promise<{ name, passed, details? }>, where client
 * provides the methods: listPrompts(), getPrompt(name, args?), listResources(),
 * readResource(uri), listTools(), callTool(name, args?).
 *
 * The tests assume that at startup the server loaded the metro data from the disk copy
 * (the data-cache/ directory). The stations «Пушкинская», «Университет», «Комсомольская»
 * and «Смоленская» are used as stable landmarks of the real dataset.
 */

const ok = (name, details) => ({ name, passed: true, details });
const fail = (name, details) => ({ name, passed: false, details });

/** Extract the system message text from a prompts/get response */
const extractPromptText = (resp) => {
  const r = resp?.result || resp;
  const msg = r?.messages?.[0];
  const text = msg?.content?.text || msg?.content?.[0]?.text || r?.messages?.[0]?.content?.[0]?.text;
  return typeof text === 'string' ? text : undefined;
};

/** Extract the tool call result text (a plain text response or structured JSON) */
const extractToolText = (resp) => {
  const r = resp?.result || resp;
  const text = r?.content?.[0]?.text;
  if (typeof text === 'string') {
    return text;
  }
  if (r?.structuredContent) {
    return JSON.stringify(r.structuredContent);
  }
  return undefined;
};

export const METRO_TESTS = {
  prompts: [
    async (client) => {
      const name = 'Список промптов содержит agent_brief и agent_prompt';
      try {
        const list = await client.listPrompts();
        const prompts = list?.prompts || list;
        const names = Array.isArray(prompts) ? prompts.map((p) => p.name) : [];
        const good = names.includes('agent_brief') && names.includes('agent_prompt');
        return good ? ok(name, { names }) : fail(name, { names });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'agent_brief упоминает метро';
      try {
        const text = extractPromptText(await client.getPrompt('agent_brief'));
        const good = typeof text === 'string' && /метро|metro/i.test(text);
        return good ? ok(name, { text }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
  ],

  resources: [
    async (client) => {
      const name = 'Список ресурсов содержит metro://lines и metro://status';
      try {
        const list = await client.listResources();
        const resources = list?.resources || list;
        const uris = Array.isArray(resources) ? resources.map((r) => r.uri) : [];
        const good = uris.includes('metro://lines') && uris.includes('metro://status');
        return good ? ok(name, { uris }) : fail(name, { uris });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'Чтение metro://lines возвращает список линий';
      try {
        const resp = await client.readResource('metro://lines');
        const r = resp?.result || resp;
        const text = r?.contents?.[0]?.text || r?.resource?.text || r?.text;
        const good = typeof text === 'string' && /Moscow Metro lines/.test(text);
        return good ? ok(name, { sample: String(text).slice(0, 120) }) : fail(name, { response: r });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'Чтение ui://mos-metro/routes.html возвращает HTML-виджет MCP Apps';
      try {
        const resp = await client.readResource('ui://mos-metro/routes.html');
        const r = resp?.result || resp;
        const content = r?.contents?.[0];
        const good =
          content?.mimeType === 'text/html;profile=mcp-app' &&
          typeof content?.text === 'string' &&
          content.text.includes('<!doctype html>') &&
          content.text.includes('ui/notifications/tool-result');
        return good
          ? ok(name, { mimeType: content.mimeType, bytes: content.text.length })
          : fail(name, {
              content: content && { mimeType: content.mimeType, sample: String(content.text).slice(0, 80) },
            });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
  ],

  tools: [
    async (client) => {
      const name = 'Список инструментов содержит mos_metro_info';
      try {
        const list = await client.listTools();
        const tools = list?.tools || list;
        const names = Array.isArray(tools) ? tools.map((t) => t.name) : [];
        return names.includes('mos_metro_info') ? ok(name, { names }) : fail(name, { names });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'get_station_info по «Пушкинская» возвращает сведения о станции (названия — en по умолчанию)';
      try {
        const text = extractToolText(
          await client.callTool('mos_metro_info', { first_metro_station: 'Пушкинская', action: 'get_station_info' }),
        );
        const good = typeof text === 'string' && text.includes('# Station') && /Pushkinskaya/i.test(text);
        return good ? ok(name, { sample: String(text).slice(0, 160) }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'get_station_info с language=ru показывает название по-русски';
      try {
        const text = extractToolText(
          await client.callTool('mos_metro_info', {
            first_metro_station: 'Пушкинская',
            action: 'get_station_info',
            language: 'ru',
          }),
        );
        const good = typeof text === 'string' && text.includes('# Station') && text.includes('Пушкинская');
        return good ? ok(name, { sample: String(text).slice(0, 160) }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'get_station_info по опечатке «Универсиет» распознаёт «Университет»';
      try {
        const text = extractToolText(
          await client.callTool('mos_metro_info', { first_metro_station: 'Универсиет', action: 'get_station_info' }),
        );
        const good = typeof text === 'string' && /Universitet|Университет/.test(text);
        return good ? ok(name, { sample: String(text).slice(0, 160) }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'get_station_info по «Смоленская» просит уточнить (две линии)';
      try {
        const text = extractToolText(
          await client.callTool('mos_metro_info', { first_metro_station: 'Смоленская', action: 'get_station_info' }),
        );
        const good = typeof text === 'string' && /Clarify/i.test(text) && /Smolenskaya|Смоленская/.test(text);
        return good ? ok(name, { sample: String(text).slice(0, 200) }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'get_station_info по бессмысленному вводу просит уточнить название';
      try {
        const text = extractToolText(
          await client.callTool('mos_metro_info', { first_metro_station: 'ыфваплджэ123', action: 'get_station_info' }),
        );
        const good = typeof text === 'string' && /could not be recognized/i.test(text);
        return good ? ok(name, { sample: String(text).slice(0, 160) }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'search_route «Университет» → «Комсомольская» строит маршруты';
      try {
        const text = extractToolText(
          await client.callTool('mos_metro_info', {
            first_metro_station: 'Университет',
            second_metro_station: 'Комсомольская',
            action: 'search_route',
          }),
        );
        const good = typeof text === 'string' && text.includes('# Routes') && /Option 1/.test(text) && /min/.test(text);
        return good ? ok(name, { sample: String(text).slice(0, 200) }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'search_route без станции прибытия сообщает об ошибке';
      try {
        const text = extractToolText(
          await client.callTool('mos_metro_info', { first_metro_station: 'Университет', action: 'search_route' }),
        );
        const good = typeof text === 'string' && /arrival station/i.test(text);
        return good ? ok(name, { sample: String(text).slice(0, 160) }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'search_route с двумя неоднозначными станциями просит уточнить обе';
      try {
        const text = extractToolText(
          await client.callTool('mos_metro_info', {
            first_metro_station: 'Смоленская',
            second_metro_station: 'Арбатская',
            action: 'search_route',
          }),
        );
        const good =
          typeof text === 'string' &&
          /departure station/i.test(text) &&
          /arrival station/i.test(text) &&
          /Smolenskaya|Смоленская/.test(text) &&
          /Arbatskaya|Арбатская/.test(text);
        return good ? ok(name, { sample: String(text).slice(0, 240) }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
  ],
};

export default METRO_TESTS;
