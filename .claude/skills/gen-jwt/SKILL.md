---
name: gen-jwt
description: "Generate JWT token for MCP server authentication. Use when user asks to generate/create a JWT token, mentions 'jwt', 'token for user', 'токен для', or wants to issue access credentials."
allowed-tools: Bash(node scripts/generate-jwt.js *), Write
argument-hint: "[username] [ttl] [options...]"
---

# JWT Token Generator

Generate a JWT token by running `node scripts/generate-jwt.js` with the appropriate parameters.

## Parameter Extraction

Parse `$ARGUMENTS` and the user's request to extract:

1. **username** (REQUIRED) — the user the token is issued to
2. **ttl** (REQUIRED) — token lifetime in format `<N>s | <N>m | <N>d | <N>y` (seconds, minutes, days, years)
3. **request** (optional) — ticket/issue ID if user mentions "заявка", "тикет", "ticket", "request", "issue", "REQ-", "JIRA-" etc. The param key is always `request`
4. **ip** (optional) — allowed IP addresses/CIDR masks, comma-separated
5. **service** (optional) — service name, passed via `-s`
6. **extra params** (optional) — any other key=value pairs

## Interactive Flow

### Step 1: Validate required params

If **username** is missing or empty:
- Tell the user: "Username is required. Please specify the user the token should be issued to."
- Wait for response. Do not proceed without it.

If **ttl** is missing, not provided, or doesn't match `<N>s | <N>m | <N>d | <N>y`:
- Tell the user: "Token lifetime (TTL) is required in format: `<N>s` (seconds), `<N>m` (minutes), `<N>d` (days), or `<N>y` (years). For example: `30d`, `1y`, `8d`. Please specify."
- Wait for response. Do not proceed without a valid TTL.

### Step 2: Ask about optional params (only if not already provided)

If the user did NOT mention a request/ticket:
- Ask: "Привязать к заявке? (введите ID заявки или Enter чтобы пропустить)"
- If user says "no", "skip", "нет", "-", or presses Enter — omit the `request` param.

If the user did NOT mention IP restrictions:
- Ask: "Ограничить по IP? (введите IP/CIDR через запятую или Enter чтобы пропустить)"
- If user says "no", "skip", "нет", "-", or presses Enter — omit the `ip` param.

### Step 3: Build and run the command

Construct the CLI command:

```
node scripts/generate-jwt.js -u <username> -ttl <ttl> [-s <service>] [-p "<params>"]
```

The `-p` value is a semicolon-separated string of `key=value` pairs built from:
- `request=<ticket>` (if provided)
- `ip=<addresses>` (if provided)
- Any extra key=value pairs from the user's message

**Examples:**

User: "Generate jwt for vpupkin, ticket REQ-12345, 1 year, aaa=foo, bbb=boo, IPs 10.0.0.0/24 and 192.168.1.100"
```bash
node scripts/generate-jwt.js -u vpupkin -ttl 1y -p "request=REQ-12345;ip=10.0.0.0/24,192.168.1.100;aaa=foo;bbb=boo"
```

User: "token for admin on 30 days"
```bash
node scripts/generate-jwt.js -u admin -ttl 30d
```

User: "jwt для svc-account, сервис my-mcp, на 8 дней"
```bash
node scripts/generate-jwt.js -u svc-account -ttl 8d -s my-mcp
```

### Step 4: Save the token to a file

After running the command:
1. Extract the token string from the output (the long hex line).
2. Generate a timestamp in format `YYYYMMDD-HHmmss` (local time).
3. Save the token to a file named `<timestamp>-jwt.txt` in the project root directory using the Write tool. The file should contain only the token string (no extra whitespace or newlines).

### Step 5: Present the result

After running the command:

1. **Parse the JSON payload**: Extract the JSON object between `__PAYLOAD_JSON__` and `__END_PAYLOAD_JSON__` markers in the script output. This object contains ALL fields that were embedded in the token payload.

2. **Show the executed command**: Display the exact `node scripts/generate-jwt.js ...` command with all flags that was run, so the user can copy/reproduce it.

3. **Show the token**: Display the generated token string (the long hex line from the output).

4. **Show the full payload table**: Render a table with ALL key-value pairs from the parsed JSON payload. Use human-readable labels where possible:
   - `user` → User
   - `service` → Service
   - `ttl` → TTL
   - `expire_iso` → Expires
   - `iat` → Issued At
   - `request` → Request
   - `ip` → IP restriction
   - Any other keys → display as-is (capitalized)

5. **Show the filename** where the token was saved (e.g., `20260413-120530-jwt.txt`).

## Important Rules

- NEVER use AskUserQuestion with predefined options for ANY parameter. All parameters are free-form text — ask the user to type values directly in chat. Do NOT suggest choices like "admin", "service-account", "30d", "1y", etc. Just ask the question and let the user type their answer.
- NEVER skip the interactive prompts for optional params — always ask once if not provided. But accept "skip" gracefully.
- NEVER proceed without valid username and ttl.
- If the user provides ttl in natural language ("1 year", "30 days", "на год"), convert it to the CLI format: `1y`, `30d`, etc.
- Russian/English: understand both. "год/лет" = `y`, "день/дней/дня" = `d`, "минут/минуты" = `m`, "секунд" = `s`.
- The `-p` flag value must be quoted and semicolon-separated: `"key1=val1;key2=val2"`
- IP addresses in the `ip` param are comma-separated (no spaces after commas in the value).
- Run the command from the project root directory.