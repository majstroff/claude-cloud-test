#!/bin/bash
# Управление сервером «Лёгкость ОС» для программы «Лёгкость.app».
#   launcher.sh start   — запустить сервер (если ещё не запущен) и дождаться готовности
#   launcher.sh open    — открыть окно приложения; печатает app или browser
#   launcher.sh window  — состояние окна: yes / closed / waiting
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

window_pid() {
  pgrep -f -- "--user-data-dir=$PROFILE" | head -1
}

open_window() {
  if [ -n "$(window_pid)" ]; then
    # Окно уже открыто — открываем в нём главную ещё раз (macOS выведет его вперёд).
    BROWSER=$(find_browser) && open -a "$BROWSER" --args --user-data-dir="$PROFILE" --app="$URL"
    echo app
    return
  fi
  if BROWSER=$(find_browser); then
    mkdir -p "$PROFILE"
    open -na "$BROWSER" --args --user-data-dir="$PROFILE" --app="$URL" --no-first-run --no-default-browser-check
    echo app
  else
    open "$URL"
    echo browser
  fi
}

# Окно считается открытым, пока интерфейс держит поток событий сервера.
# Закрыто — когда окно уже было и потоков нет три проверки подряд (перезагрузка страницы не считается).
window_state() {
  local clients
  clients=$(curl -fsS --max-time 2 "$URL/api/health" 2>/dev/null | grep -o '"clients":[0-9]*' | cut -d: -f2)
  if [ -z "$clients" ]; then
    # Сервер не отвечает — значит, его остановили.
    if [ -f "$STATE" ]; then echo closed; else echo waiting; fi
    return
  fi
  if [ "$clients" -gt 0 ]; then
    echo 0 >"$STATE"
    echo yes
  elif [ -f "$STATE" ]; then
    local n
    n=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
    echo "$n" >"$STATE"
    if [ "$n" -ge 3 ]; then echo closed; else echo yes; fi
  else
    echo waiting
  fi
}

stop() {
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
  *) echo "Использование: $0 start|open|window|stop|status" >&2; exit 2 ;;
esac
