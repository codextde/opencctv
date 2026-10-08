#!/bin/zsh
# Store screenshots. Needs a build with EXPO_PUBLIC_SCREENSHOTS=1 on the simulator and a demo server
# (see README). Usage: maestro/run-screenshots.sh <simulator-udid> [server-url] [languages] [output-dir]
set -e
cd "$(dirname "$0")/.."
UDID=${1:?simulator udid}
SERVER=${2:-http://localhost:18190}
LANGS=(${=3:-en de})
OUT=${4:-screenshots}

xcrun simctl status_bar "$UDID" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --operatorName "" --batteryState discharging --batteryLevel 100
xcrun simctl ui "$UDID" appearance dark

for l in $LANGS; do
  mkdir -p "$OUT/$l"
  maestro --device "$UDID" test -e SERVER="$SERVER" -e USER="${USER_NAME:-admin}" -e PASS="${USER_PASS:-admin12345}" \
    -e APP_LANG="$l" -e OUT="$PWD/$OUT/$l" maestro/screenshots.yaml
  maestro --device "$UDID" test -e "LINK=opencctv://shots?server=$SERVER&user=${USER_NAME:-admin}&pass=${USER_PASS:-admin12345}&lang=$l&go=/camera/demo-storefront" \
    maestro/live-landscape.yaml
  xcrun simctl io "$UDID" screenshot "$OUT/$l/08-fullscreen-landscape.png" >/dev/null
done
