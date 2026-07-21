#!/usr/bin/env node

/**
 * Shared test cases for the template MCP server (src/template)
 * Covers: prompts, resources, tools
 *
 * Each test case is a function(client) -> Promise<{ name, passed, details? }>
 * where client provides methods:
 *   - listPrompts(), getPrompt(name, args?)
 *   - listResources(), readResource(uri)
 *   - listTools(), callTool(name, args?)
 */

const ok = (name, details) => ({ name, passed: true, details });
const fail = (name, details) => ({ name, passed: false, details });

// Utility: extract system text from prompts/get response
const extractPromptText = (resp) => {
  // resp may be raw result or wrapped; support both shapes used by clients
  const r = resp?.result || resp;
  const msg = r?.messages?.[0];
  const text = msg?.content?.text || msg?.content?.[0]?.text || r?.messages?.[0]?.content?.[0]?.text;
  return typeof text === 'string' ? text : undefined;
};

export const TEMPLATE_TESTS = {
  prompts: [
    async (client) => {
      const name = 'List prompts contains agent_brief and agent_prompt';
      try {
        const list = await client.listPrompts();
        const prompts = list?.prompts || list;
        const names = Array.isArray(prompts) ? prompts.map((p) => p.name) : [];
        const okBrief = names.includes('agent_brief');
        const okPrompt = names.includes('agent_prompt');
        return okBrief && okPrompt ? ok(name, { names }) : fail(name, { names });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'Get agent_brief returns text';
      try {
        const resp = await client.getPrompt('agent_brief');
        const text = extractPromptText(resp);
        return text ? ok(name, { text }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'Get agent_prompt returns text';
      try {
        const resp = await client.getPrompt('agent_prompt');
        const text = extractPromptText(resp);
        return text ? ok(name, { text }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'Get custom_prompt returns dynamic text';
      try {
        const resp = await client.getPrompt('custom_prompt', { sample: '1' });
        const text = extractPromptText(resp);
        const hasWord = typeof text === 'string' && text.includes('Custom prompt content');
        return hasWord ? ok(name, { text }) : fail(name, { text });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
  ],

  resources: [
    async (client) => {
      const name = 'List resources contains custom-resource://resource1';
      try {
        const list = await client.listResources();
        const resources = list?.resources || list;
        const uris = Array.isArray(resources) ? resources.map((r) => r.uri) : [];
        const found = uris.includes('custom-resource://resource1');
        return found ? ok(name, { uris }) : fail(name, { uris });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'Read resource custom-resource://resource1 returns content';
      try {
        const resp = await client.readResource('custom-resource://resource1');
        // Different clients return differently; normalize
        const r = resp?.result || resp;
        const text = r?.resource?.text || r?.contents?.[0]?.text || r?.text || r?.resource?.content;
        const okText = typeof text === 'string' && text.length > 0;
        return okText ? ok(name, { text }) : fail(name, { response: r });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
  ],

  tools: [
    async (client) => {
      const name = 'List tools contains example_tool and example_search';
      try {
        const list = await client.listTools();
        const tools = list?.tools || list;
        const names = Array.isArray(tools) ? tools.map((t) => t.name) : [];
        const ok1 = names.includes('example_tool');
        const ok2 = names.includes('example_search');
        return ok1 && ok2 ? ok(name, { names }) : fail(name, { names });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'Call example_tool returns formatted result';
      try {
        const resp = await client.callTool('example_tool', { query: 'ping' });
        const r = resp?.result || resp;
        // Both structuredContent and text are acceptable; check message echo
        const structured = r?.structuredContent;
        const text = r?.content?.[0]?.text;
        const hasProcessed =
          (structured && structured.message?.includes('Processed query')) ||
          (typeof text === 'string' && text.includes('Processed query'));
        return hasProcessed ? ok(name, { response: r }) : fail(name, { response: r });
      } catch (e) {
        return fail(name, { error: e?.message });
      }
    },
    async (client) => {
      const name = 'Call example_tool without query should fail';
      try {
        await client.callTool('example_tool', {});
        return fail(name, { error: 'Expected failure, got success' });
      } catch (e) {
        return ok(name, { error: e?.message });
      }
    },
  ],
};

export default TEMPLATE_TESTS;
