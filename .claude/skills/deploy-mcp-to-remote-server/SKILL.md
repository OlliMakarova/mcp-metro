---
name: deploy-mcp-to-remote-server
description: >-
  Deploy, stop, restart, update and diagnose this fa-mcp-sdk MCP server on a remote
  production server as a self-contained systemd Docker container behind a reverse
  proxy (Caddy or nginx), with a once-a-minute in-container git auto-update. Use when
  the user asks to deploy / roll out / stop / restart / update or check the status of
  the MCP server on the server (развернуть, выключить, перезапустить, обновить, диагностика).
disable-model-invocation: true
allowed-tools: Bash, Read
---

# Deploy an fa-mcp-sdk MCP server to a remote server (self-contained systemd Docker)

Project-agnostic skill: nothing here is hard-coded to a particular project, server or domain.
The service/container name is derived from the host project's `package.json` name and the node
version from its `.envrc`; everything else comes from the config file. Copy this whole skill folder
into another fa-mcp-sdk project, fill in `remote-server-config.local.yaml`, and it works.

Almost everything is done by scripts. Your job: pick the right subcommand, run it, and report the
output to the user in clear Russian. Do not hand-craft SSH or docker commands — the orchestrator
encapsulates them.

## The one command you run

```bash
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs <subcommand>
```

| User intent | Subcommand | What it does |
|-------------|------------|--------------|
| create deploy key / нет ключа | `keygen` | Generate a read-only GitHub Deploy Key and print the public part with instructions. |
| deploy / roll out / развернуть | `deploy` | Build the image on the server (context-less) and (re)create the container; wire up the reverse proxy (Caddy or nginx). |
| status / diagnostics / диагностика | `status` | Container, app service, git head, local + public `/health`, cron, last update log, reverse-proxy vhost. |
| stop / выключи | `stop` | Stop the container (the in-container auto-update stops with it). |
| start / включи | `start` | Start the container again. |
| restart / перезапусти | `restart` | Restart just the app service inside the container (fast, no rebuild). |
| update now / обнови сейчас | `update` | Run `update.cjs --force` inside the container (immediate rebuild from the branch). |
| logs / логи | `logs [N]` | Last N app-service journal lines (default 200). |
| bootstrap/build logs | `bootlog [N]` | Last N first-boot (clone/build) journal lines — use when a fresh deploy is still building. |
| auto-update log / errors | `updatelog [N]` | Last auto-update verdict (SUCCESS/FAIL), an `[ERROR]` scan, and the last update-run log. Use to check whether the once-a-minute rebuild is succeeding or failing. |
| shell into container | `shell` | Open an interactive bash shell inside the container. |
| run a command inside | `exec -- <cmd>` | Run an arbitrary command inside the container (runs from `/`; node is at `/usr/local/bin/node`). |
| uninstall / удали с сервера | `uninstall --yes` | Remove container, image, volume and the reverse-proxy vhost (Caddy block or nginx site). Destructive — needs `--yes`. |
| raw ssh access | `ssh` | Print the ssh command for manual login. |

For manual server-side operations (reading logs, restart/stop, force rebuild, entering the
container) see `README.md` next to this file.

Report exactly what the script printed (health, git verdict, errors) — do not invent results.

## Configuration

Settings live in `.claude/skills/deploy-mcp-to-remote-server/remote-server-config.local.yaml`
(out of version control; template in `remote-server-config.example.yaml`). Required keys:
`server.*`, `git.repoUrl`, `git.deployKeyPath`, `project.statePath` (and optional `project.branch`,
`project.projectPath`), `mcp.dns`, the `deployConfigYaml` block (branch + email → deploy/config.yml),
and the whole `configLocalYaml` block (the app's runtime config → config/local.yaml). The
`configLocalYaml.telegram` section doubles as the deploy-notification channel (its creds are
auto-appended to deploy/config.yml). `env.DEBUG` is optional (default `config-info`). That file is
blocked from direct reading by a permission rule (it holds secrets) — rely on `status`/`logs`
output for debugging. If the script reports the config is missing a value, tell the user which key
to add — do not guess credentials.

## First-time deploy — order of steps

1. `keygen` — creates the read-only Deploy Key. Relay the printed public key to the user and ask
   them to add it on GitHub (repo → Settings → Deploy keys → Add deploy key, **read-only**), and to
   set `git.deployKeyPath` in the local config.
2. `deploy` — builds the image and starts the container. The **first boot** clones the repo and
   builds inside the container, which takes a few minutes; `status` shows `bootstrap: still running`
   until it is ready. Do not treat a not-yet-healthy first boot as a failure — re-check `status`.

## How the deployment works (for explaining or debugging)

- **One self-contained image.** `docker/Dockerfile` is an Ubuntu image running real **systemd** as
  PID 1. It carries no app code. `remote.cjs deploy` pipes it to `docker build -` on the server
  (no build context, so nothing lands on the server disk).
- **Boot-time bootstrap.** A baked `mcp-bootstrap.service` clones the repo (using the read-only
  Deploy Key), writes `config/local.yaml` (from `configLocalYaml`), `deploy/config.yml` (branch +
  Telegram creds) and `.env` (with `WS_HOST=127.0.0.1` — the container runs `--network host`, so the
  app listens on loopback only and the reverse proxy fronts it), runs `yarn install` + build, then
  installs the app as a systemd service via the repo's own `deploy/srv.cjs install`.
- **`--network host`.** The container shares the host's network (so it reaches whatever the host can,
  e.g. a Telegram tunnel behind fake-IP DNS). The app binds `127.0.0.1:<port>` only; no port is
  published on a public interface.
- **Auto-update within 2 minutes.** A cron job inside the container runs the repo's `update.cjs`
  every minute. On any change to the branch it hard-resets, rebuilds and `systemctl restart`s the
  service, then posts a SUCCESS/FAIL verdict. `update.cjs` is **universal**: it e-mails (only where a
  `mail` agent exists, i.e. a classic host deploy) and posts to **Telegram** (whenever bot creds are
  set) — inside the container only Telegram fires. The checkout and `node_modules` live in the Docker
  volume `<name>-data` (fast restarts); the app's data cache (`data-cache`, or `project.cacheDir`) is
  bind-mounted to the host `project.statePath` so it persists even across container/volume removal.
- **Reverse proxy from the fa-mcp-sdk templates.** `deploy` auto-detects Caddy or nginx and renders
  the project's own templates (`deploy/CADDY/Caddyfile`, `deploy/NGINX/sites-enabled/mcp-template.com.conf`
  + `deploy/NGINX/snippets/mcp-proxy.conf`), substituting the domain / port / upstream. These are
  MCP-aware: `/mcp`, `/sse`, `/messages` get `proxy_buffering off` (Caddy: `flush_interval -1`) and
  hour-long read timeouts so the Server-Sent-Events streams the MCP protocol uses are forwarded frame
  by frame and never time out; `/agent-tester` gets a 10-minute timeout; `/metrics` and `/admin` get
  IP allow-lists; `/health` a short timeout; everything else a normal buffered/compressed catch-all.
  - **nginx**: obtains a per-domain Let's Encrypt cert with `certbot certonly --nginx` and writes the
    HTTPS site using certbot's own SSL params (`include /etc/letsencrypt/options-ssl-nginx.conf`), plus
    an HTTP→HTTPS redirect. The shared proxy snippet goes to `/etc/nginx/snippets/mcp-proxy.conf`.
  - **Caddy**: extracts the `<dns> { … }` site block from the template and appends it to the shared
    `/etc/caddy/Caddyfile` transactionally (validate a temp copy first); Caddy handles TLS itself.
  - If certbot fails (DNS not pointing here yet, port 80 blocked) the HTTPS site is skipped — re-run
    `deploy` once DNS resolves. If the templates are missing, a minimal single-location block is used.
  - **Do NOT add security headers at the proxy**: fa-mcp-sdk already emits `X-Content-Type-Options`,
    `X-Frame-Options` and `Referrer-Policy` on every response — the templates deliberately omit them
    so clients never receive duplicate/conflicting values.
  - **`webServer.trustProxy: true`** must be set in `configLocalYaml` so Express honours the
    `X-Forwarded-*` headers (otherwise HTTPS detection, per-IP rate limiting and the OAuth discovery
    documents break). `publicBaseUrl` is derived as `https://<dns>` — do not set it in `configLocalYaml`.
  - Note: behind a NAT/front-proxy that hides the real client IP (nginx sees one fixed address), the
    `/metrics` and `/admin` IP allow-lists cannot distinguish external from internal callers.
- **Privileged container.** Running systemd as PID 1 requires `--privileged` + a cgroup mount. This
  grants the container broad host access; it is acceptable on a dedicated own server but reduces
  isolation — mention it if the user asks about security.

## Troubleshooting

- **`git.deployKeyPath is not set` / key not found** → run `keygen`, add the public key to
  GitHub (read-only), set `git.deployKeyPath`, then `deploy`.
- **First boot seems stuck** → `status` shows `bootstrap: still running` during the first clone +
  build (a few minutes). Use `bootlog` for the build phase.
- **Container won't start / systemd errors** → the host must allow `--privileged` and expose cgroup;
  check the container logs (`logs` / `docker logs <container>`) and that cgroup v2 is mounted.
- **Notifications not arriving** → the container runs with `--network host`, so it uses the host's
  connectivity; if the host itself cannot reach the notification endpoint (e.g. a blocked network),
  neither can the container. Check what the host can reach.
- **Public `/health` fails but local works** → reverse-proxy issue. Caddy: check the block in
  `/etc/caddy/Caddyfile` + `journalctl -u caddy`. nginx: `nginx -t`, the site in
  `/etc/nginx/sites-available/<dns>.conf`, the snippet `/etc/nginx/snippets/mcp-proxy.conf`, and the
  cert under `/etc/letsencrypt/live/<dns>/`. The DNS `A` record for `<dns>` must point at the server.
- **MCP client hangs / no streaming (nginx)** → the `/mcp` (and `/sse`) location must have
  `proxy_buffering off` and a long `proxy_read_timeout`; without them nginx buffers the SSE stream and
  the client sees a hung session. The fa-mcp-sdk template sets this — check it wasn't flattened to a
  single `location /`.
- **No Telegram notifications** → verify `configLocalYaml.telegram.botToken` / `chatId`; the verdict
  is sent by `update.cjs` only when both are set.
