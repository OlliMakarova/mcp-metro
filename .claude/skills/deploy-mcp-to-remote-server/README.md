# deploy-mcp-to-remote-server — операции вручную

Скилл обезличен: его можно скопировать в любой проект MCP-сервера на `fa-mcp-sdk`, заполнить
три файла в `config/` (`remote-server-config.local.yaml`, `local.yaml`, `config.yml`) — и он
заработает. Ничего проектно-специфичного здесь не
захардкожено: имя сервиса и версия Node определяются автоматически из проекта, всё остальное —
из настроек.

Штатный способ управления — подкоманды оркестратора (запускать из корня проекта):

```bash
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs <команда>
# keygen | deploy | status | stop | start | restart | update
# logs [N] | bootlog [N] | updatelog [N] | shell | exec -- <cmd...> | uninstall --yes | ssh
```

Ниже — те же операции «руками» по SSH, если оркестратор недоступен или нужна тонкая отладка.

## Откуда берутся имена и значения (ничего не захардкожено)

| Что | Откуда берётся | Обозначение ниже |
|-----|----------------|------------------|
| Хост, порт, SSH-пользователь, ключ | `server.*` в конфиге | — |
| Имя сервиса/контейнера/образа/тома | из `package.json` `name` проекта (или `service.name` в конфиге) | `<NAME>` |
| Имя systemd-сервиса приложения | `<NAME>--<instance>` (instance по умолчанию `prod`) | `<SERVICE>` |
| Имя контейнера / образа / тома | `<NAME>` / `<NAME>:latest` / `<NAME>-data` | `<CONTAINER>` |
| Каталог проекта внутри контейнера | `project.projectPath` (по умолчанию `/opt/node/<NAME>`) | `<PROJECT_DIR>` |
| Постоянный кэш на хосте | `project.statePath` (по умолчанию `/opt/<NAME>`) | — |
| Внутренний порт приложения | `config/local.yaml` → `webServer.port` | `<PORT>` |
| Публичный домен | `mcp.dns` | `<DNS>` |
| Node внутри контейнера | стабильный симлинк `/usr/local/bin/node` (версия — из `.envrc` проекта) | — |

Быстро увидеть текущие значения и состояние: `node .../remote.cjs status`.
Получить готовую команду SSH: `node .../remote.cjs ssh`.

## Подключение к серверу

```bash
# Печатает точную команду ssh из вашего конфига:
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs ssh
# затем подключиться выведенной командой, например:
# ssh -i <keyPath> -p <port> <user>@<host>
```

## Чтение логов

```bash
# Логи приложения (systemd-журнал сервиса), последние строки:
docker exec <CONTAINER> journalctl -o cat --no-pager -n 200 -u <SERVICE>
# Логи приложения в реальном времени:
docker exec -it <CONTAINER> journalctl -o cat -xefu <SERVICE>

# Логи первичной сборки (клон/установка/build) — если контейнер только поднялся:
docker exec <CONTAINER> journalctl -o cat --no-pager -n 200 -u mcp-bootstrap.service

# Вердикт и лог автообновления (что делал update.cjs) — проще через оркестратор:
node .../remote.cjs updatelog
# вручную: файлы deploy__<NAME>__status.log / __last_deploy.log / __cumulative.log
# лежат в каталоге на уровень выше <PROJECT_DIR> внутри контейнера.

# Логи самого контейнера (вывод systemd как PID 1):
docker logs --tail 100 <CONTAINER>
```

## Перезапуск и остановка сервиса

```bash
# Перезапустить приложение (без пересборки), контейнер продолжает работать:
docker exec <CONTAINER> systemctl restart <SERVICE>

# Остановить только приложение (контейнер и автообновление остаются живы):
docker exec <CONTAINER> systemctl stop <SERVICE>
docker exec <CONTAINER> systemctl start <SERVICE>

# Полностью выключить (контейнер + внутренний cron автообновления):
docker stop <CONTAINER>
docker start <CONTAINER>
```

## Принудительная пересборка внутри контейнера (update.cjs -f)

Заставить `update.cjs` немедленно подтянуть ветку, переустановить зависимости, пересобрать
и перезапустить сервис (и отправить уведомление, если оно настроено), не дожидаясь минутного крона:

```bash
docker exec <CONTAINER> /usr/local/bin/node <PROJECT_DIR>/update.cjs --force
# или проще:
node .../remote.cjs update
```

## Полная пересборка контейнера (образ + контейнер)

```bash
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs deploy
```

Собирает образ на сервере без контекста (`docker build -`, Dockerfile передаётся по SSH),
пересоздаёт контейнер и настраивает обратный прокси. Полностью снести всё
(контейнер, образ, том, блок прокси) — `... uninstall --yes`.

## Зайти внутрь контейнера для отладки

```bash
node .../remote.cjs shell
# или вручную:
docker exec -it <CONTAINER> bash -l
# внутри, например:
cd <PROJECT_DIR>
git log -1 --oneline
cat config/local.yaml
cat deploy/config.yml
systemctl status <SERVICE>
/usr/local/bin/node -v
```

## Диагностика обратного прокси (публичный доступ)

Скилл сам определяет, что стоит на сервере — **Caddy** или **nginx** — и настраивает его для `<DNS>`.

- **Caddy**: блок в общем `/etc/caddy/Caddyfile`, TLS автоматический.
  ```bash
  grep -n "<DNS>" /etc/caddy/Caddyfile
  caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
  systemctl reload caddy
  ```
- **nginx**: сайт в `/etc/nginx/sites-available/<DNS>.conf`, TLS через `certbot --nginx`.
  ```bash
  nginx -t && systemctl reload nginx
  certbot certificates | grep -A3 "<DNS>"
  ```

Раздел «REVERSE PROXY» в `node .../remote.cjs status` показывает, какой прокси настроен и есть ли TLS.
