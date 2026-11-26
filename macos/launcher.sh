#!/bin/bash
# Управление сервером «Лёгкость ОС» для программы «Лёгкость.app».
# Обычная программа (Lyogkost.swift) использует только start и stop; open/window — для
# упрощённого варианта на AppleScript, который собирается без инструментов разработчика.
#   launcher.sh start   — запустить сервер (если ещё не запущен) и дождаться готовности
#   launcher.sh open    — открыть окно приложения; печатает app или browser
#   launcher.sh window  — состояние окна: yes / closed / waiting
#   launcher.sh windows — для проверки: процесс окна, число окон и потоков
#   launcher.sh stop    — закрыть окно и остановить сервер, если его запускала программа
#
# Папка установки: ~/Documents/Frame OS (app, Vault, .frame-data).
# Другую можно указать в переменной FRAME_HOME.

APP_HOME="${FRAME_HOME:-$HOME/Documents/Frame OS}"
APP_DIR="$APP_HOME/app"
DATA_DIR="$APP_HOME/.frame-data"
VAULT_DIR="${FRAME_VAULT_PATH:-$APP_HOME/Vault}"
PORT="${FRAME_PORT:-4317}"
URL="http://localhost:$PORT"
PIDFILE="$DATA_DIR/app-server.pid"
LOG="$DATA_DIR/app-server.log"
PROFILE="$DATA_DIR/app-window"
STATE="$DATA_DIR/app-window.state"

# Программы, запущенные из Finder, не видят PATH из Терминала.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  fi
fi
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_DIR=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$NODE_DIR" ] && export PATH="$NODE_DIR:$PATH"
fi

healthy() {
  curl -fsS --max-time 2 "$URL/api/health" >/dev/null 2>&1
}

ours_running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

fail() {
  echo "$1" >&2
  exit 1
}

start() {
  mkdir -p "$DATA_DIR"
  rm -f "$STATE"
  # Если прошлый запуск ещё останавливает сервер — ждём, чтобы не подхватить уходящий сервер.
  for _ in $(seq 1 40); do
    [ -f "$DATA_DIR/app-stopping" ] || break
    sleep 0.25
  done
  if healthy; then
    # Сервер уже работает (например, запущен ярлыком .command) — им и пользуемся.
    exit 0
  fi
  [ -d "$APP_DIR" ] || fail "Не найдена папка приложения: $APP_DIR"
  command -v node >/dev/null 2>&1 || fail "Не найден Node.js. Установите его с nodejs.org (версия 22 или новее)."
  [ -f "$APP_DIR/apps/web/dist/index.html" ] || fail "Интерфейс не собран. В Терминале: cd ~/Documents/\"Frame OS\"/app && npm install && npm run build"
  [ -d "$APP_DIR/node_modules/tsx" ] || fail "Не установлены зависимости. В Терминале: cd ~/Documents/\"Frame OS\"/app && npm install"
  cd "$APP_DIR" || fail "Нет доступа к $APP_DIR"
  FRAME_VAULT_PATH="$VAULT_DIR" FRAME_DATA_DIR="$DATA_DIR" FRAME_PORT="$PORT" \
    nohup node --import tsx apps/server/src/main.ts >"$LOG" 2>&1 </dev/null &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 60); do
    if healthy; then exit 0; fi
    if ! ours_running; then
      fail "Сервер остановился при запуске. Последние строки журнала ($LOG):
$(tail -n 8 "$LOG")"
    fi
    sleep 0.5
  done
  fail "Сервер не ответил за 30 секунд. Журнал: $LOG"
}

find_browser() {
  for name in "Google Chrome" "Yandex" "Microsoft Edge" "Brave Browser" "Chromium" "Arc"; do
    for dir in /Applications "$HOME/Applications"; do
      if [ -d "$dir/$name.app" ]; then
        echo "$dir/$name.app"
        return 0
      fi
    done
  done
  return 1
}

# Главный процесс окна программы (Chrome с отдельным профилем), без вспомогательных процессов.
window_pid() {
  ps -axo pid=,command= | grep -F -- "--user-data-dir=$PROFILE" | grep -v -- "--type=" | grep -v grep | awk '{print $1}' | head -1
}

clients() {
  curl -fsS --max-time 2 "$URL/api/health" 2>/dev/null | grep -o '"clients":[0-9]*' | cut -d: -f2
}

# Вывести окно программы вперёд по номеру процесса (без разрешений «Универсального доступа»).
activate_pid() {
  osascript -l JavaScript -e "ObjC.import('AppKit'); var a = \$.NSRunningApplication.runningApplicationWithProcessIdentifier($1); a.isNil() ? 'no' : (a.activateWithOptions(3) ? 'ok' : 'no')" 2>/dev/null
}

# Сколько обычных окон у процесса (через CoreGraphics, без особых разрешений).
# Свёрнутые окна и окна на других рабочих столах тоже считаются.
window_count() {
  osascript -l JavaScript -e "ObjC.import('CoreGraphics'); var l = ObjC.deepUnwrap(ObjC.castRefToObject(\$.CGWindowListCopyWindowInfo(16, 0))) || []; l.filter(function (w) { return w.kCGWindowOwnerPID == $1 && w.kCGWindowLayer == 0 && w.kCGWindowBounds && w.kCGWindowBounds.Height > 150 && w.kCGWindowBounds.Width > 150; }).length" 2>/dev/null
}

# Важно: всегда запускаем браузер с отдельным профилем (open -n … --user-data-dir).
# Команда «open -a "Google Chrome"» без профиля открыла бы обычный Chrome пользователя.
open_window() {
  local pid n
  pid=$(window_pid)
  n=$(clients)
  if [ -n "$pid" ] && [ "${n:-0}" -gt 0 ] && [ "$(activate_pid "$pid")" = "ok" ]; then
    echo app
    return
  fi
  if BROWSER=$(find_browser); then
    mkdir -p "$PROFILE"
    # Если окно-процесс уже есть, Chrome с тем же профилем откроет окно программы в нём.
    open -na "$BROWSER" --args --user-data-dir="$PROFILE" --app="$URL/?shell=mac" --no-first-run --no-default-browser-check
    echo app
  else
    open "$URL"
    echo browser
  fi
}

# Окно считается открытым, пока интерфейс держит поток событий сервера.
# Если потоков нет (страница грузится или перезагружается), но окно программы на экране есть —
# тоже открыто. Закрыто — когда окно уже было, а теперь нет ни потоков, ни окна две проверки подряд.
window_state() {
  local clients pid count n
  clients=$(clients)
  if [ -z "$clients" ]; then
    # Сервер не отвечает — значит, его остановили.
    if [ -f "$STATE" ]; then echo closed; else echo waiting; fi
    return
  fi
  if [ "$clients" -gt 0 ]; then
    echo 0 >"$STATE"
    echo yes
    return
  fi
  if [ ! -f "$STATE" ]; then
    echo waiting
    return
  fi
  pid=$(window_pid)
  count=0
  [ -n "$pid" ] && count=$(window_count "$pid")
  if [ "${count:-0}" -gt 0 ]; then
    echo 0 >"$STATE"
    echo yes
    return
  fi
  n=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
  echo "$n" >"$STATE"
  echo "$(date '+%F %T') нет окна и потоков (проверка $n), процесс окна: ${pid:-нет}" >>"$DATA_DIR/app-window.log"
  if [ "$n" -ge 2 ]; then echo closed; else echo yes; fi
}

stop() {
  touch "$DATA_DIR/app-stopping"
  trap 'rm -f "$DATA_DIR/app-stopping"' EXIT
  local w
  w=$(window_pid)
  [ -n "$w" ] && kill "$w" 2>/dev/null
  if ours_running; then
    local pid
    pid=$(cat "$PIDFILE")
    kill "$pid" 2>/dev/null
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -9 "$pid" 2>/dev/null
  fi
  rm -f "$PIDFILE" "$STATE"
}

case "$1" in
  start) start ;;
  open) open_window ;;
  window) window_state ;;
  stop) stop ;;
  status) if healthy; then echo running; else echo stopped; fi ;;
  windows) p=$(window_pid); if [ -n "$p" ]; then echo "pid=$p windows=$(window_count "$p") clients=$(clients)"; else echo "нет окна"; fi ;;
  *) echo "Использование: $0 start|open|window|stop|status|windows" >&2; exit 2 ;;
esac
