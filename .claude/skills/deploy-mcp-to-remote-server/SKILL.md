---
name: deploy-mcp-to-remote-server
description: >-
  Deploy, stop, restart, update and diagnose this fa-mcp-sdk MCP server on a remote
  production server as a self-contained systemd Docker container behind a reverse
  proxy (Caddy or nginx), with a once-a-minute in-container git auto-update. Use when
  the user asks to deploy / roll out / stop / restart / update or check the status of
  the MCP server on the server (deploy, stop, restart, update, diagnose).
disable-model-invocation: true
allowed-tools: Bash, Read
---

# Deploy an fa-mcp-sdk MCP server to a remote server (self-contained systemd Docker)

Project-agnostic skill: nothing here is hard-coded to a particular project, server or domain.
The service/container name is derived from the host project's `package.json` name and the node
version from its `.envrc`; everything else comes from the `config/` files. Copy this whole skill
folder into another fa-mcp-sdk project, fill in `config/*.yaml`, and it works.

Almost everything is done by scripts. Your job: pick the right subcommand, run it, and report the
output to the user clearly (in the user's language). Do not hand-craft SSH or docker commands — the
orchestrator encapsulates them.

## The one command you run

```bash
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs <subcommand>
```

| User intent | Subcommand | What it does |
|-------------|------------|--------------|
| create deploy key / no key | `keygen` | Generate a read-only GitHub Deploy Key and print the public part with instructions. |
| deploy / roll out | `deploy` | Build the image on the server (context-less) and (re)create the container; wire up the reverse proxy (Caddy or nginx). |
| status / diagnostics | `status` | Container, app service, git head, local + public `/health`, cron, last update log, reverse-proxy vhost. |
| stop | `stop` | Stop the container (the in-container auto-update stops with it). |
| start | `start` | Start the container again. |
| restart | `restart` | Restart just the app service inside the container (fast, no rebuild). |
| change config only / push local.yaml, config.yml | `push-config` | Copy the skill's `config/local.yaml` and `config.yml` into the running container and restart the app service. Nothing is rebuilt, git is not touched. `--container` restarts the whole container instead; `--no-restart` only pushes. Skips the restart when both files are already identical. |
| update now | `update` | Run `update.cjs --force` inside the container (immediate rebuild from the branch). |
| logs | `logs [N]` | Last N app-service journal lines (default 200). |
| bootstrap/build logs | `bootlog [N]` | Last N first-boot (clone/build) journal lines — use when a fresh deploy is still building. |
| auto-update log / errors | `updatelog [N]` | Last auto-update verdict (SUCCESS/FAIL), an `[ERROR]` scan, and the last update-run log. Use to check whether the once-a-minute rebuild is succeeding or failing. |
| shell into container | `shell` | Open an interactive bash shell inside the container. |
| run a command inside | `exec -- <cmd>` | Run an arbitrary command inside the container (runs from `/`; node is at `/usr/local/bin/node`). |
| uninstall / remove from server | `uninstall --yes` | Remove container, image, volume and the reverse-proxy vhost (Caddy block or nginx site). Destructive — needs `--yes`. |
| raw ssh access | `ssh` | Print the ssh command for manual login. |

For manual server-side operations (reading logs, restart/stop, force rebuild, entering the
container) see `README.md` next to this file.

Report exactly what the script printed (health, git verdict, errors) — do not invent results.

## Configuration

Settings live in `.claude/skills/deploy-mcp-to-remote-server/config/` — three real files (out of
version control via `config/.gitignore`; each has an `*.example.*` template beside it):

- **`remote-server-config.local.yaml`** — connection + deploy params. Required: `server.*`,
  `git.repoUrl`, `git.deployKeyPath`, `mcp.dns`; optional `project.statePath`/`projectPath`/`cacheDir`,
  `env.DEBUG` (default `config-info`), `service.name`/`instance`, `container.nodeVersion`.
- **`local.yaml`** — the MCP app's own `config/local.yaml`, copied **verbatim** into the container.
  Whatever the project supports goes here. The skill reads only `webServer.port` from it. Do **not**
  set `webServer.publicBaseUrl` — the skill injects `https://<mcp.dns>`. (The app may keep its own
  `telegram:` here for its own alerts; that is independent of the deploy notifications below.)
- **`config.yml`** — the container's `deploy/config.yml` (read by `update.cjs`): `branch`, the deploy
  skill's `telegram:` block (`botToken`/`chatId`), optional `email`, and an optional `smtp:` block.
  With `smtp:` update.cjs e-mails the report over SMTP via nodemailer (works in the container, no MTA
  needed); without it, e-mail uses the host `mail` command (classic host deploy only). `config.yml`
  is copied verbatim into the container — the deploy notifications read **only** from here.

The real files hold secrets and may be blocked from the Read tool — inspect them with a small
`node -e "fs.readFileSync(...)"` if needed, and rely on `status`/`logs`/`updatelog` for debugging.
If the script reports a file or key is missing, tell the user which one — do not guess credentials.

**Changing a setting after the first deploy.** These local files stay the source of truth, and
`push-config` is the fast way to apply an edit: it copies `local.yaml` and `config.yml` into the
running container and restarts the app service — no image rebuild, no git operation, seconds instead
of minutes. It is safe because the bootstrap materialises those two files only on the FIRST boot
(its unit carries `ConditionPathExists=!/var/lib/deploy-bootstrap-done`), so a later container
restart does not overwrite them from the now-stale PID 1 environment. A subsequent `deploy` does
recreate the container from the current local files, so the two paths stay consistent. File contents
are never printed — both hold secrets; the command reports only created / updated / unchanged.

Two cases still need `deploy` rather than `push-config`: a changed `webServer.port` (the reverse
proxy points at the old one — the command warns about exactly this) and anything under
`remote-server-config.local.yaml`, since that drives the container's own run-time environment.

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
  Deploy Key), writes `config/local.yaml` (from the skill's `local.yaml`), `deploy/config.yml` (from
  `config.yml` + Telegram creds) and `.env` (with `WS_HOST=127.0.0.1` — the container runs `--network host`, so the
  app listens on loopback only and the reverse proxy fronts it), runs `yarn install` + build, then
  installs the app as a systemd service via the repo's own `deploy/srv.cjs install`.
- **`--network host`.** The container shares the host's network (so it reaches whatever the host can,
  e.g. a Telegram tunnel behind fake-IP DNS). The app binds `127.0.0.1:<port>` only; no port is
  published on a public interface.
- **Auto-update within 2 minutes.** A cron job inside the container runs the repo's `update.cjs`
  every minute. On any change to the branch it hard-resets, rebuilds and `systemctl restart`s the
  service, then posts a SUCCESS/FAIL verdict. `update.cjs` notifies via every configured channel:
  **Telegram** (whenever bot creds are set — the usual in-container channel), and **e-mail** either
  over **SMTP** (nodemailer, when `config.yml` has an `smtp:` block — works in the container) or via
  the host `mail` command (classic host deploy). The checkout and `node_modules` live in the Docker
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
  - **`webServer.trustProxy: true`** must be set in `local.yaml` so Express honours the
    `X-Forwarded-*` headers (otherwise HTTPS detection, per-IP rate limiting and the OAuth discovery
    documents break). `publicBaseUrl` is derived as `https://<dns>` — do not set it in `local.yaml`.
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
- **No Telegram notifications** → verify `config.yml`'s `telegram.botToken` / `chatId`; the verdict
  is sent by `update.cjs` only when both are set.
