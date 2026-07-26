# Deployment

How MCP METRO runs in production: a self-contained Docker container with systemd inside, behind a reverse proxy,
updating itself from git.

## The recommended path: the deploy skill

Everything is scripted. From Claude Code, use the `/deploy-mcp-to-remote-server` skill; under the hood it is a single
orchestrator:

```bash
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs <subcommand>
```

| Intent                        | Subcommand         | What happens                                                                    |
|-------------------------------|--------------------|---------------------------------------------------------------------------------|
| Create a read-only deploy key | `keygen`           | Generates the key pair and prints the public part with instructions              |
| Deploy or roll out            | `deploy`           | Builds the image on the server, (re)creates the container, wires the reverse proxy |
| Status and diagnostics        | `status`           | Container, app service, git head, local and public `/health`, cron, last update, vhost |
| Stop / start                  | `stop` / `start`   | Stops or starts the container; the in-container updater follows it                |
| Restart the app only          | `restart`          | Restarts the app service inside the container — fast, no rebuild                  |
| Apply a config change         | `push-config`      | Copies `local.yaml` and `config.yml` into the running container and restarts the app service |
| Update now                    | `update`           | Forces an immediate rebuild from the tracked branch                              |
| Logs                          | `logs [N]`         | Last N lines of the app service journal (default 200)                            |
| First-boot logs               | `bootlog [N]`      | Clone and build output — what to read while a fresh deploy is still building      |
| Update verdicts               | `updatelog [N]`    | Last update outcome, an error scan, and the last update run                       |
| Shell inside                  | `shell`, `exec`    | Interactive shell or a single command inside the container                        |
| Remove                        | `uninstall --yes`  | Removes container, image, volume and the proxy vhost — destructive                 |

First-time order: `keygen`, have the public key added to the repository as a **read-only** deploy key, then `deploy`.
The first boot clones and builds inside the container and takes a few minutes; until it finishes, `status` keeps
reporting that the bootstrap is still running. That is not a failure — re-check `status`.

## How the container is built

- **One image, no app code.** An Ubuntu image runs real systemd as PID 1. The image is piped to `docker build -` on the
  server with no build context, so nothing but the Dockerfile crosses the wire.
- **Boot-time bootstrap.** A baked-in systemd unit clones the repository with the read-only deploy key, writes
  `config/local.yaml`, `deploy/config.yml` and `.env`, installs dependencies and builds.
- **Host networking.** The container runs with `--network host`, so the app binds `127.0.0.1` and the reverse proxy on
  the host reaches it directly.
- **Self-update.** `update.cjs` runs inside the container once a minute: it compares the tracked branch with the local
  head, and when the branch has moved it pulls, rebuilds, restarts the app service and reports the verdict — to
  Telegram, and optionally by e-mail over SMTP. `remote.cjs update` triggers the same routine immediately with
  `--force`.

## Configuration files for a deploy

Three files under `.claude/skills/deploy-mcp-to-remote-server/config/`, each with an `*.example.*` template beside it
and each kept out of version control:

| File                                | Role                                                                                         |
|-------------------------------------|----------------------------------------------------------------------------------------------|
| `remote-server-config.local.yaml`   | Connection and deploy parameters: `server.*`, `git.repoUrl`, `git.deployKeyPath`, `mcp.dns`   |
| `local.yaml`                        | The app's own `config/local.yaml`, copied verbatim into the container                          |
| `config.yml`                        | The container's `deploy/config.yml` read by `update.cjs`: tracked `branch`, Telegram credentials for deploy reports, optional SMTP |

### Applying a config change without a rebuild

These files stay the source of truth on the workstation, and `push-config` is the fast way to apply an
edit to a running server:

```bash
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs push-config
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs push-config --container
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs push-config --no-restart
```

The command copies both files into the checkout inside the container, compares them by SHA-256,
replaces only what differs (keeping the previous version as `/tmp/pc-prev-<file>` inside the
container), then restarts the app service and polls `/health`. When both files already match, the
restart is skipped. `--container` restarts the whole container instead of just the service, and
`--no-restart` pushes without restarting. Contents are never printed to the console, because both
files hold secrets.

Nothing is rebuilt and git is not touched, so this takes seconds rather than the minutes a full
`deploy` needs. It is safe because the bootstrap writes those two files only on the **first** boot —
its systemd unit is guarded by `ConditionPathExists=!/var/lib/deploy-bootstrap-done` — so a later
container restart does not overwrite them from the now-stale environment of PID 1. A subsequent
`deploy` recreates the container from the same local files, so both paths stay consistent.

Two changes still require a full `deploy`: a different `webServer.port`, because the reverse-proxy
vhost still points at the old one (the command warns when it detects that mismatch), and anything in
`remote-server-config.local.yaml`, because that defines the container's own run-time environment.

Two notes that save time:

- Do **not** set `webServer.publicBaseUrl` in the deploy `local.yaml` — the skill injects `https://<mcp.dns>` itself.
- The deploy pipeline's Telegram credentials in `config.yml` are separate from the application's own `telegram:` block.
  One channel reports build and update outcomes, the other reports metro data-source state changes. See
  [Data Sources](./data-sources.md).

## Reverse proxy

The skill wires either Caddy or nginx. Ready configurations live in `deploy/`:

- `deploy/CADDY/Caddyfile`
- `deploy/NGINX/sites-enabled/` plus the shared snippets in `deploy/NGINX/snippets/` (proxy pass, TLS parameters,
  wildcard certificate)

The proxy terminates TLS and forwards to the app's port. Two settings must match it:

```yaml
webServer:
  trustProxy: true                                  # so client IPs — and therefore rate limits — are real
  publicBaseUrl: 'https://mcp-metro.time-gold.com'  # so widget links and the widget CSP point at the public host
```

`publicBaseUrl` matters more than it looks: it is the single source of the external address for the route widget's data
link and for its Content-Security-Policy. Get it wrong and the widget loads but cannot fetch its data. See
[Route Widget](./route-widget.md).

The reference production vhost for this project is kept in `config/__server__/TIMEWEB/`.

## Alternative: systemd service without Docker

`deploy/srv.cjs` manages the app as a plain systemd service on a host that already has Node.js. It detects the Node
version (CLI argument, then `.envrc`, then the current one), reads the service name and port from `package.json` and the
config, generates the unit file and manages the process, including freeing the port on removal.
`deploy/srv.sh.readme.md` documents the subcommands. A PM2 variant (`deploy/pm2.config.js`, `deploy/pm2reg.sh`) is
available as well.

This path is simpler to inspect but has no self-update loop and no container isolation.

## Checklist before going public

- `webServer.auth.enabled: true` with real tokens, or a network policy that keeps the server private —
  [Authentication](./authentication.md).
- `widgetData.signSecret` set explicitly, so widget links survive restarts.
- `webServer.trustProxy: true` and `publicBaseUrl` pointing at the public host.
- `restApi.rateLimit` and `mcp.rateLimit` reviewed for the expected traffic — [REST API](./rest-api.md).
- Telegram credentials in place if you want to hear about data-source degradation.
- `/health` reachable through the proxy, since that is what the container and the proxy poll.
