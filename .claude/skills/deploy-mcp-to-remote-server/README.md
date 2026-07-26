# deploy-mcp-to-remote-server — manual operations

The skill is project-agnostic: copy it into any `fa-mcp-sdk` MCP-server project, fill in the three
files under `config/` (`remote-server-config.local.yaml`, `local.yaml`, `config.yml`), and it works.
Nothing project-specific is hard-coded here: the service name and the Node version are derived
automatically from the project, everything else comes from the config.

The normal way to operate it is the orchestrator subcommands (run from the project root):

```bash
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs <command>
# keygen | deploy | status | stop | start | restart | update
# logs [N] | bootlog [N] | updatelog [N] | shell | exec -- <cmd...> | uninstall --yes | ssh
```

Below are the same operations done "by hand" over SSH, for when the orchestrator is unavailable or
you need fine-grained debugging.

## Where names and values come from (nothing is hard-coded)

| What | Source | Notation below |
|------|--------|----------------|
| Host, port, SSH user, key | `server.*` in the config | — |
| Service/container/image/volume name | project's `package.json` `name` (or `service.name` in the config) | `<NAME>` |
| App systemd service name | `<NAME>--<instance>` (instance defaults to `prod`) | `<SERVICE>` |
| Container / image / volume names | `<NAME>` / `<NAME>:latest` / `<NAME>-data` | `<CONTAINER>` |
| Project directory inside the container | `project.projectPath` (default `/opt/node/<NAME>`) | `<PROJECT_DIR>` |
| Persistent cache on the host | `project.statePath` (default `/opt/<NAME>`) | — |
| App's internal port | `config/local.yaml` → `webServer.port` | `<PORT>` |
| Public domain | `mcp.dns` | `<DNS>` |
| Node inside the container | stable symlink `/usr/local/bin/node` (version from the project's `.envrc`) | — |

To quickly see the current values and state: `node .../remote.cjs status`.
To get a ready-to-use SSH command: `node .../remote.cjs ssh`.

## Connecting to the server

```bash
# Prints the exact ssh command from your config:
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs ssh
# then connect with the printed command, e.g.:
# ssh -i <keyPath> -p <port> <user>@<host>
```

## Reading logs

```bash
# App logs (the service's systemd journal), last lines:
docker exec <CONTAINER> journalctl -o cat --no-pager -n 200 -u <SERVICE>
# App logs in real time:
docker exec -it <CONTAINER> journalctl -o cat -xefu <SERVICE>

# First-boot logs (clone / install / build) — when the container has just come up:
docker exec <CONTAINER> journalctl -o cat --no-pager -n 200 -u mcp-bootstrap.service

# Auto-update verdict and log (what update.cjs did) — easiest via the orchestrator:
node .../remote.cjs updatelog
# by hand: the files deploy__<NAME>__status.log / __last_deploy.log / __cumulative.log
# live one level above <PROJECT_DIR> inside the container.

# The container's own logs (systemd output as PID 1):
docker logs --tail 100 <CONTAINER>
```

## Restarting and stopping the service

```bash
# Restart the app (no rebuild); the container keeps running:
docker exec <CONTAINER> systemctl restart <SERVICE>

# Stop only the app (the container and auto-update stay alive):
docker exec <CONTAINER> systemctl stop <SERVICE>
docker exec <CONTAINER> systemctl start <SERVICE>

# Turn it off completely (container + the in-container auto-update cron):
docker stop <CONTAINER>
docker start <CONTAINER>
```

## Force a rebuild inside the container (update.cjs -f)

Make `update.cjs` immediately pull the branch, reinstall dependencies, rebuild and restart the
service (and send a notification, if configured), without waiting for the once-a-minute cron:

```bash
docker exec <CONTAINER> /usr/local/bin/node <PROJECT_DIR>/update.cjs --force
# or simply:
node .../remote.cjs update
```

## Full container rebuild (image + container)

```bash
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs deploy
```

Builds the image on the server context-lessly (`docker build -`, the Dockerfile is piped over SSH),
recreates the container and wires up the reverse proxy. To remove everything (container, image,
volume, proxy vhost) — `... uninstall --yes`.

## Getting a shell inside the container for debugging

```bash
node .../remote.cjs shell
# or by hand:
docker exec -it <CONTAINER> bash -l
# inside, for example:
cd <PROJECT_DIR>
git log -1 --oneline
cat config/local.yaml
cat deploy/config.yml
systemctl status <SERVICE>
/usr/local/bin/node -v
```

## Diagnosing the reverse proxy (public access)

The skill auto-detects what is running on the server — **Caddy** or **nginx** — and configures it for `<DNS>`.

- **Caddy**: a block in the shared `/etc/caddy/Caddyfile`, TLS handled automatically.
  ```bash
  grep -n "<DNS>" /etc/caddy/Caddyfile
  caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
  systemctl reload caddy
  ```
- **nginx**: a site in `/etc/nginx/sites-available/<DNS>.conf`, TLS via `certbot --nginx`.
  ```bash
  nginx -t && systemctl reload nginx
  certbot certificates | grep -A3 "<DNS>"
  ```

The "REVERSE PROXY" section of `node .../remote.cjs status` shows which proxy is configured and whether TLS is present.
