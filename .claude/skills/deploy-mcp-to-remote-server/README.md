# deploy-mcp-to-remote-server — операции вручную

Штатный способ управления — подкоманды оркестратора (запускать из корня проекта):

```bash
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs <команда>
# keygen | deploy | status | stop | start | restart | update | logs [N]
# bootlog [N] | shell | exec -- <cmd...> | uninstall --yes | ssh
```

Ниже — те же операции «руками» по SSH, если оркестратор недоступен или нужна тонкая отладка.
Всё, что связано с приложением, живёт **внутри** одного контейнера `mcp-metro`, где работает
полноценный systemd: приложение поднято как systemd-сервис `mcp-metro--prod`, а раз в минуту
внутренний cron запускает `update.cjs` (он подтягивает изменения из ветки, пересобирает и
перезапускает сервис, шлёт вердикт в Telegram).

## Подключение к серверу

```bash
ssh -i C:\Users\vv\.ssh\id_rsa root@77.73.132.128
```

Ключевые пути и имена:

| Что | Значение |
|-----|----------|
| Имя контейнера | `mcp-metro` |
| Имя systemd-сервиса приложения (внутри контейнера) | `mcp-metro--prod` |
| Каталог проекта внутри контейнера | `/opt/node/mcp-metro` |
| Постоянный кэш скачанных данных метро (на хосте) | `/opt/mcp-metro` (том, смонтирован в `.../data-cache`) |
| Внутренний порт приложения | `9049` (опубликован только на `127.0.0.1`) |
| Публичный адрес | `https://mcp-metro.time-gold.com` (проксирует Caddy) |
| Абсолютный путь к node внутри | `/root/.nvm/versions/node/v22.17.1/bin/node` |

## Чтение логов

```bash
# Логи приложения (systemd-журнал сервиса), последние строки:
docker exec mcp-metro journalctl -o cat --no-pager -n 200 -u mcp-metro--prod
# Логи приложения в реальном времени:
docker exec -it mcp-metro journalctl -o cat -xefu mcp-metro--prod

# Логи первичной сборки (клон/установка/build) — если контейнер только поднялся:
docker exec mcp-metro journalctl -o cat --no-pager -n 200 -u mcp-bootstrap.service

# Лог работы автообновления (что делал update.cjs по крону):
docker exec mcp-metro cat /tmp/mcp-update.log

# Логи самого контейнера (вывод systemd как PID 1):
docker logs --tail 100 mcp-metro
```

## Перезапуск и остановка сервиса

```bash
# Перезапустить приложение (без пересборки), контейнер продолжает работать:
docker exec mcp-metro systemctl restart mcp-metro--prod

# Остановить только приложение (контейнер и автообновление остаются живы):
docker exec mcp-metro systemctl stop mcp-metro--prod
# и снова запустить:
docker exec mcp-metro systemctl start mcp-metro--prod

# Полностью выключить (контейнер + внутренний cron автообновления):
docker stop mcp-metro
# Включить обратно:
docker start mcp-metro
```

## Принудительная пересборка внутри контейнера (update.cjs -f)

Заставить `update.cjs` немедленно подтянуть ветку, переустановить зависимости, пересобрать
и перезапустить сервис (и отправить вердикт в Telegram), не дожидаясь минутного крона:

```bash
docker exec mcp-metro /root/.nvm/versions/node/v22.17.1/bin/node /opt/node/mcp-metro/update.cjs --force
```

## Полная пересборка контейнера (образ + контейнер)

Пересобрать образ и пересоздать контейнер с нуля проще всего оркестратором:

```bash
node .claude/skills/deploy-mcp-to-remote-server/scripts/remote.cjs deploy
```

Он собирает образ на сервере без контекста (`docker build -`, Dockerfile передаётся по SSH),
пересоздаёт контейнер и при необходимости добавляет блок в Caddy. Полностью снести всё
(контейнер, образ, том, блок Caddy) — `... uninstall --yes`.

## Зайти внутрь контейнера для отладки

```bash
docker exec -it mcp-metro bash -l
# внутри, например:
cd /opt/node/mcp-metro
git log -1 --oneline
cat config/local.yaml
cat deploy/config.yml
systemctl status mcp-metro--prod
# node доступен по абсолютному пути (в non-login shell PATH его не содержит):
/root/.nvm/versions/node/v22.17.1/bin/node -v
```

## Диагностика Caddy (публичный доступ)

Блок для домена находится в общем `/etc/caddy/Caddyfile` (обслуживает и другие сайты).
Файл лога `/opt/log/caddy/mcp-metro.time-gold.com.log` должен принадлежать пользователю `caddy`.

```bash
grep -n "mcp-metro.time-gold.com" /etc/caddy/Caddyfile
caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
systemctl reload caddy          # применить без даунтайма
journalctl -u caddy --since "5 min ago" | grep -iE "error|acme|mcp-metro"
```
