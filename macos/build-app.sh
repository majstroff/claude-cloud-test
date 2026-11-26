#!/bin/bash
# Собирает программу «Лёгкость.app» и кладёт её в «Программы» и в Док.
#   bash macos/build-app.sh            — установить в /Applications (или ~/Applications) и добавить в Док
#   bash macos/build-app.sh --no-dock  — без Дока
#   bash macos/build-app.sh --out DIR  — только собрать в папку DIR
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="Лёгкость"
DOCK=1
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-dock) DOCK=0 ;;
    --out) OUT="$2"; shift ;;
  esac
  shift
done

[ "$(uname)" = "Darwin" ] || { echo "Сборка возможна только на macOS"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/$NAME.app"

# Приложение-сценарий, которое остаётся открытым (нужно для «idle» и «quit»).
osacompile -s -o "$APP" "$HERE/$NAME.applescript"
cp "$HERE/launcher.sh" "$APP/Contents/Resources/launcher.sh"
chmod +x "$APP/Contents/Resources/launcher.sh"

# Иконка.
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$HERE/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$HERE/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/applet.icns"
rm -f "$APP/Contents/Resources/Assets.car"

PL="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $NAME" "$PL" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleName string $NAME" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Лёгкость ОС" "$PL" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Delete :CFBundleIdentifier" "$PL" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string local.frame-os.lyogkost" "$PL"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$PL" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" "$PL" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string applet" "$PL"
/usr/libexec/PlistBuddy -c "Add :NSAppleEventsUsageDescription string «Лёгкость» открывает окно приложения в браузере." "$PL" 2>/dev/null || true

# Локальная подпись, чтобы macOS не считала программу повреждённой.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
xattr -cr "$APP" 2>/dev/null || true

if [ -n "$OUT" ]; then
  mkdir -p "$OUT"
  rm -rf "${OUT:?}/$NAME.app"
  cp -R "$APP" "$OUT/"
  echo "Собрано: $OUT/$NAME.app"
  exit 0
fi

DEST=/Applications
if ! [ -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi
# Если программа запущена — завершаем её перед заменой.
osascript -e "tell application id \"local.frame-os.lyogkost\" to quit" >/dev/null 2>&1 || true
rm -rf "${DEST:?}/$NAME.app"
cp -R "$APP" "$DEST/"
touch "$DEST/$NAME.app"
echo "Установлено: $DEST/$NAME.app"

if [ "$DOCK" = 1 ]; then
  if defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "local.frame-os.lyogkost\|$NAME.app"; then
    echo "Уже в Доке"
  else
    URL_ENC=$(osascript -l JavaScript -e "encodeURI('file://$DEST/$NAME.app/')")
    defaults write com.apple.dock persistent-apps -array-add "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>$URL_ENC</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>"
    killall Dock
    echo "Добавлено в Док"
  fi
fi
