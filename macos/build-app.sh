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

# Иконка.
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$HERE/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$HERE/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$WORK/AppIcon.icns"

if command -v swiftc >/dev/null 2>&1 && [ "${FRAME_APP_LEGACY:-0}" != 1 ]; then
  # Настоящая программа macOS: своё окно на WebKit, без Chrome.
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  echo "Компилирую программу…"
  swiftc -O -target "$(uname -m)-apple-macos11.0" -o "$APP/Contents/MacOS/Lyogkost" "$HERE/Lyogkost.swift" \
    -framework AppKit -framework WebKit
  cp "$WORK/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
  cat >"$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>Lyogkost</string>
  <key>CFBundleIdentifier</key><string>local.frame-os.lyogkost</string>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>Лёгкость ОС</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>$(date +%Y%m%d%H%M)</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
else
  # Запасной вариант без инструментов разработчика: сценарий AppleScript, окно в браузере.
  echo "Нет компилятора Swift (установите: xcode-select --install). Собираю упрощённый вариант."
  osacompile -s -o "$APP" "$HERE/$NAME.applescript"
  cp "$WORK/AppIcon.icns" "$APP/Contents/Resources/applet.icns"
  rm -f "$APP/Contents/Resources/Assets.car"
  PL="$APP/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName $NAME" "$PL" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleName string $NAME" "$PL"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Лёгкость ОС" "$PL" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIdentifier" "$PL" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string local.frame-os.lyogkost" "$PL"
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$PL" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" "$PL" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string applet" "$PL"
fi
cp "$HERE/launcher.sh" "$APP/Contents/Resources/launcher.sh"
chmod +x "$APP/Contents/Resources/launcher.sh"

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
for _ in $(seq 1 40); do
  [ "$(osascript -e 'application id "local.frame-os.lyogkost" is running' 2>/dev/null)" = "true" ] || break
  sleep 0.25
done
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
