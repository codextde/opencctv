#!/bin/zsh
# Store screenshots. Needs a build with EXPO_PUBLIC_SCREENSHOTS=1 on the simulator and a demo server
# (see README). Usage: maestro/run-screenshots.sh <simulator-udid> [server-url] [languages]
set -e
cd "$(dirname "$0")/.."
UDID=${1:?simulator udid}
SERVER=${2:-http://localhost:18190}
LANGS=(${=3:-en de})

xcrun simctl status_bar "$UDID" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --operatorName "" --batteryState discharging --batteryLevel 100
xcrun simctl ui "$UDID" appearance dark

for l in $LANGS; do
  mkdir -p "screenshots/$l"
  maestro --device "$UDID" test -e SERVER="$SERVER" -e USER="${USER_NAME:-admin}" -e PASS="${USER_PASS:-admin12345}" \
    -e APP_LANG="$l" -e OUT="$PWD/screenshots/$l" maestro/screenshots.yaml
done
