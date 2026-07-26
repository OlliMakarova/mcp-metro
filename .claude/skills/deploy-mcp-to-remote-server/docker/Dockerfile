# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Project-agnostic self-contained systemd image for an fa-mcp-sdk MCP server.
#
# The image carries NO application code and hard-codes NOTHING project-specific.
# On first boot the baked-in mcp-bootstrap.service clones the repository (read-only
# Deploy Key passed via env), writes config/local.yaml + deploy/config.yml + .env
# from env, builds the project and installs it as a systemd service through the
# repo's own deploy/srv.cjs. A cron job then runs the repo's update.cjs every
# minute, which git-pulls the branch and, on change, rebuilds and restarts the
# service (and notifies, if the project configures it).
#
# Because it runs a real systemd as PID 1, the container must be started with
# --privileged and a cgroup mount (see the deploy orchestrator / SKILL.md).
#
# The node version is a build arg (the orchestrator passes it from the project's
# .envrc). Built context-less:  docker build --build-arg NODE_VERSION=x -t <name> -
# ─────────────────────────────────────────────────────────────────────────────
FROM ubuntu:22.04

ARG NODE_VERSION=22.17.1
ENV DEBIAN_FRONTEND=noninteractive \
    container=docker \
    TZ=Europe/Moscow \
    NVM_DIR=/root/.nvm \
    NODE_VERSION=${NODE_VERSION}

# System packages: systemd (init), cron (auto-update trigger), git/openssh (clone),
# build toolchain (native npm modules), curl/ca-certificates (health + nvm install).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      systemd systemd-sysv cron git openssh-client curl ca-certificates tzdata \
      build-essential python3 bash procps \
 && ln -fs /usr/share/zoneinfo/$TZ /etc/localtime \
 && rm -rf /var/lib/apt/lists/*

# Strip systemd units that are meaningless / harmful inside a container.
RUN find /etc/systemd/system /lib/systemd/system \
      \( -path '*getty*' -o -name 'systemd-udevd*' -o -name 'systemd-network*' \
         -o -name 'systemd-resolved*' -o -name 'systemd-timesyncd*' \) \
      -exec rm -f {} + 2>/dev/null || true

# nvm + the project's pinned Node (from .envrc's `nvm use <ver>`, passed as NODE_VERSION)
# so the repo's .envrc and yarn work unchanged. A stable /usr/local/bin/node symlink
# lets cron/tools call node without knowing the exact version directory.
RUN curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
 && . "$NVM_DIR/nvm.sh" \
 && nvm install "$NODE_VERSION" \
 && nvm alias default "$NODE_VERSION" \
 && ln -sf "$NVM_DIR/versions/node/v$NODE_VERSION/bin/node" /usr/local/bin/node \
 && npm i -g yarn@1.22.22 \
 && nvm cache clear

# ── Boot-time bootstrap script (clone / configure / build / install service) ──
COPY <<'BOOT' /usr/local/bin/mcp-bootstrap.sh
#!/usr/bin/env bash
set -euo pipefail

# systemd starts services with a clean environment, so recover the variables
# that `docker run -e ...` set on PID 1.
while IFS= read -r -d '' kv; do
  case "$kv" in
    REPO_URL=*|BRANCH=*|PROJECT_DIR=*|GIT_SSH_KEY_B64=*|CONFIG_LOCAL_YAML_B64=*|\
DEPLOY_CONFIG_YAML_B64=*|DEBUG=*|PUBLIC_BASE_URL=*|NODE_VERSION=*|SERVICE_NAME=*|SERVICE_INSTANCE=*) export "$kv" ;;
  esac
done < /proc/1/environ

: "${PROJECT_DIR:=/opt/node/app}"
: "${BRANCH:=master}"
: "${DEBUG:=config-info}"
: "${SERVICE_NAME:=$(basename "$PROJECT_DIR")}"
: "${SERVICE_INSTANCE:=prod}"
: "${NODE_VERSION:=22.17.1}"

# systemd starts this service without HOME; nvm.sh dereferences $HOME under set -u.
export HOME=/root
export NVM_DIR=/root/.nvm
set +u
. "$NVM_DIR/nvm.sh"
nvm use "$NODE_VERSION" >/dev/null
set -u

# Read-only Deploy Key for GitHub.
mkdir -p /root/.ssh && chmod 700 /root/.ssh
if [ -n "${GIT_SSH_KEY_B64:-}" ]; then
  echo "$GIT_SSH_KEY_B64" | base64 -d > /root/.ssh/id_ed25519
  chmod 600 /root/.ssh/id_ed25519
fi
ssh-keyscan -t ed25519,rsa github.com >> /root/.ssh/known_hosts 2>/dev/null || true

# Materialise the checkout. PROJECT_DIR is never empty (the data-cache volume is
# bind-mounted at PROJECT_DIR/data-cache), so `git clone` would refuse it — instead
# init a repo in place and check the branch out over the existing mount points.
mkdir -p "$PROJECT_DIR"
git config --global --add safe.directory "$PROJECT_DIR"
cd "$PROJECT_DIR"
if [ ! -d "$PROJECT_DIR/.git" ]; then
  git init -q
  git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"
  git fetch --prune origin "$BRANCH"
  git checkout -f -B "$BRANCH" "origin/$BRANCH"
  git branch --set-upstream-to="origin/$BRANCH" "$BRANCH" 2>/dev/null || true
fi

# Materialise runtime config from env (base64 to survive multi-line transport).
if [ -n "${CONFIG_LOCAL_YAML_B64:-}" ]; then
  echo "$CONFIG_LOCAL_YAML_B64" | base64 -d > config/local.yaml
fi
mkdir -p deploy
if [ -n "${DEPLOY_CONFIG_YAML_B64:-}" ]; then
  echo "$DEPLOY_CONFIG_YAML_B64" | base64 -d > deploy/config.yml
fi

# .env is the systemd EnvironmentFile for the app service. The container runs with
# --network host (so it shares the host's connectivity, e.g. a Telegram tunnel), so
# WS_HOST=127.0.0.1 keeps the app on loopback only — the reverse proxy fronts it and
# the port is never exposed on a public interface.
# WS_PUBLIC_BASE_URL is derived from the DNS by the orchestrator (https://<dns>),
# so publicBaseUrl no longer needs to be set by hand in config/local.yaml.
cat > .env <<ENVV
SERVICE_NAME=$SERVICE_NAME
SERVICE_INSTANCE=$SERVICE_INSTANCE
NODE_ENV=production
DEBUG=$DEBUG
WS_HOST=127.0.0.1
WS_PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-}
ENVV

# Dependencies + build.
yarn install --frozen-lockfile
yarn cb

# Install (or reinstall) the app as a systemd service via the repo's own script.
node deploy/srv.cjs install

# Auto-update every minute: stable node symlink (cron PATH is minimal); update.cjs
# itself sources .envrc for its yarn/build steps.
cat > /etc/cron.d/mcp-update <<CRON
* * * * * root /usr/local/bin/node $PROJECT_DIR/update.cjs >/tmp/mcp-update.log 2>&1
CRON
chmod 0644 /etc/cron.d/mcp-update

echo "mcp-bootstrap: done ($SERVICE_NAME--$SERVICE_INSTANCE)"
BOOT

RUN chmod +x /usr/local/bin/mcp-bootstrap.sh

# ── systemd oneshot that runs the bootstrap at boot ──────────────────────────
COPY <<'UNIT' /etc/systemd/system/mcp-bootstrap.service
[Unit]
Description=MCP deploy bootstrap (clone, build, install service)
# Docker configures the network namespace before init runs, so network.target
# (which is always reached) is enough. network-online.target would hang here
# because systemd-networkd is intentionally absent in this image.
After=network.target
ConditionPathExists=!/var/lib/deploy-bootstrap-done

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=HOME=/root
ExecStart=/usr/local/bin/mcp-bootstrap.sh
ExecStartPost=/bin/touch /var/lib/deploy-bootstrap-done

[Install]
WantedBy=multi-user.target
UNIT

RUN systemctl enable mcp-bootstrap.service cron.service

EXPOSE 9049
STOPSIGNAL SIGRTMIN+3

HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=5 \
  CMD curl -fsS http://127.0.0.1:9049/health || exit 1

ENTRYPOINT ["/sbin/init"]
