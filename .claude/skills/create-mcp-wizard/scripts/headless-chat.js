#!/usr/bin/env node
/**
 * Multi-turn wrapper around POST /agent-tester/api/chat/test. Sends a sequence of user messages
 * in a single server-side session so the agent retains dialog history across questions.
 *
 * Input: a plain text file, one message per non-empty line. Lines starting with '#' are ignored.
 *
 * Usage:
 *   node headless-chat.js --port 9876 --messages scenarios.txt [options]
 *
 * Options:
 *   --port <n>             Web server port (required)
 *   --messages <path>      Text file, one user message per line (required)
 *   --auth <header>        Full Authorization header value. Optional.
 *   --verbose              Include per-turn LLM request/response in trace
 *   --max-result <n>       Max chars per tool result (default 4000)
 *   --max-trace <n>        Max total trace size (default 50000)
 *   --agent-prompt <s>     Override system prompt (applied to the whole dialog)
 *   --model <name>         Model name (default: let server choose)
 *   --timeout <ms>         Request timeout per message (default 120000)
 *   --session <id>         Start from an existing sessionId instead of a fresh one
 *   --session-file <path>  Persist final sessionId (same semantics as headless-test.js)
 *   --stop-on-error        Abort the sequence on first non-2xx response (default: continue)
 *   --out <path>           Write an aggregated JSON array of per-turn responses to this file
 *
 * Each response is also printed to stdout as a JSON object prefixed by a header line
 *   === MESSAGE <n>/<total>: <first-80-chars> ===
 * Exit code: 0 if all messages returned 2xx, 1 otherwise.
 */

import fs from 'fs';
import http from 'http';

function getOpt (flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function hasFlag (flag) { return process.argv.includes(flag); }

const port = getOpt('--port');
const messagesArg = getOpt('--messages');
const auth = getOpt('--auth');
const verbose = hasFlag('--verbose');
const maxResult = getOpt('--max-result', '4000');
const maxTrace = getOpt('--max-trace', '50000');
const agentPrompt = getOpt('--agent-prompt');
const model = getOpt('--model');
const timeout = Number(getOpt('--timeout', '120000'));
const sessionOpt = getOpt('--session');
const sessionFile = getOpt('--session-file');
const stopOnError = hasFlag('--stop-on-error');
const outPath = getOpt('--out');

if (!port || !messagesArg) {
  console.error('Usage: headless-chat.js --port <n> --messages <file> [--session-file <path>] [--verbose]');
  process.exit(2);
}

const raw = fs.readFileSync(messagesArg, 'utf8');
const messages = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
if (messages.length === 0) {
  console.error(`no messages found in ${messagesArg}`);
  process.exit(2);
}

let sessionId = sessionOpt;
if (!sessionId && sessionFile) {
  try {
    const s = fs.readFileSync(sessionFile, 'utf8').trim();
    if (s) sessionId = s;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`session-file read error: ${e.message}`);
      process.exit(2);
    }
  }
}

function sendOne (message) {
  return new Promise((resolve, reject) => {
    const body = {
      message,
      mcpConfig: { url: `http://localhost:${port}/mcp`, transport: 'http' },
    };
    if (sessionId) body.sessionId = sessionId;
    if (auth) body.mcpConfig.headers = { Authorization: auth };
    if (agentPrompt) body.agentPrompt = agentPrompt;
    if (model) body.modelConfig = { model };

    const payload = JSON.stringify(body);
    const qs = `?verbose=${verbose}&maxResultChars=${maxResult}&maxTraceChars=${maxTrace}`;

    const req = http.request({
      hostname: 'localhost',
      port,
      path: `/agent-tester/api/chat/test${qs}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(auth ? { Authorization: auth } : {}),
      },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* keep raw */ }
        resolve({ status: res.statusCode, text, parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

(async () => {
  const results = [];
  let anyFailure = false;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const header = `=== MESSAGE ${i + 1}/${messages.length}: ${msg.slice(0, 80)} ===`;
    process.stdout.write(header + '\n');

    let result;
    try {
      result = await sendOne(msg);
    } catch (e) {
      anyFailure = true;
      process.stdout.write(`request error: ${e.message}\n`);
      results.push({ message: msg, error: e.message });
      if (stopOnError) break;
      continue;
    }

    process.stdout.write(result.text + '\n');

    if (result.parsed?.sessionId) sessionId = result.parsed.sessionId;
    const ok = result.status >= 200 && result.status < 300;
    if (!ok) anyFailure = true;

    results.push({
      message: msg,
      status: result.status,
      response: result.parsed ?? result.text,
    });

    if (!ok && stopOnError) break;
  }

  if (sessionFile && sessionId) {
    try { fs.writeFileSync(sessionFile, sessionId); } catch (e) { console.error(`session-file write skipped: ${e.message}`); }
  }

  if (outPath) {
    try { fs.writeFileSync(outPath, JSON.stringify(results, null, 2)); } catch (e) { console.error(`out write failed: ${e.message}`); }
  }

  process.exit(anyFailure ? 1 : 0);
})();
