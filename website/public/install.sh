#!/bin/sh
# OpenCCTV installer for Linux and macOS.
#
#   curl -fsSL https://opencctv.codext.de/install.sh | sh
#
# Downloads the latest release binary from GitHub (opencctv-<os>-<arch>),
# installs it to /usr/local/bin/opencctv and sets it up to start automatically
# (systemd on Linux, launchd on macOS) via `opencctv service install`.
#
# Options (environment variables):
#   OPENCCTV_VERSION=v1.2.3     install a specific release instead of the latest
#   OPENCCTV_INSTALL_DIR=/path  install somewhere else (default /usr/local/bin)
#   OPENCCTV_NO_SERVICE=1       only install the binary, don't set up autostart
#
# Source: https://github.com/codextde/opencctv  (MIT license)

set -eu

REPO="codextde/opencctv"
INSTALL_DIR="${OPENCCTV_INSTALL_DIR:-/usr/local/bin}"
VERSION="${OPENCCTV_VERSION:-latest}"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
service_failed() { die "Could not set up autostart. The binary is installed; start the server manually with: opencctv serve"; }

# Everything runs inside main so a truncated download never executes half a script.
main() {
  case "$(uname -s)" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    MINGW* | MSYS* | CYGWIN*) die "On Windows, run in PowerShell: irm https://opencctv.codext.de/install.ps1 | iex" ;;
    *) die "Unsupported operating system: $(uname -s). Use Docker instead: https://opencctv.codext.de/#quick-start" ;;
  esac

  case "$(uname -m)" in
    x86_64 | amd64) arch="x64" ;;
    arm64 | aarch64) arch="arm64" ;;
    *) die "Unsupported CPU architecture: $(uname -m). Use Docker instead: https://opencctv.codext.de/#quick-start" ;;
  esac

  # Rosetta: prefer the native arm64 binary on Apple silicon.
  if [ "$os" = "darwin" ] && [ "$arch" = "x64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
    arch="arm64"
  fi

  asset="opencctv-${os}-${arch}"
  if [ "$VERSION" = "latest" ]; then
    url="https://github.com/${REPO}/releases/latest/download/${asset}"
  else
    url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
  fi

  sudo=""
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then sudo="sudo"; fi
  fi

  tmp="$(mktemp -d 2>/dev/null || mktemp -d -t opencctv)"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  say "Downloading ${asset} (${VERSION})"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar -o "$tmp/opencctv" "$url" || die "Download failed: $url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --show-progress -O "$tmp/opencctv" "$url" || die "Download failed: $url"
  else
    die "Neither curl nor wget is installed."
  fi
  chmod 755 "$tmp/opencctv"

  if [ "$os" = "darwin" ]; then
    xattr -d com.apple.quarantine "$tmp/opencctv" 2>/dev/null || true
  fi

  say "Installing to ${INSTALL_DIR}/opencctv"
  if [ -d "$INSTALL_DIR" ] && [ -w "$INSTALL_DIR" ]; then
    mv "$tmp/opencctv" "$INSTALL_DIR/opencctv"
  else
    [ -n "$sudo" ] || [ "$(id -u)" -eq 0 ] || die "No write access to ${INSTALL_DIR} and sudo is not available. Set OPENCCTV_INSTALL_DIR to a writable directory."
    $sudo mkdir -p "$INSTALL_DIR"
    $sudo mv "$tmp/opencctv" "$INSTALL_DIR/opencctv"
  fi

  bin="$INSTALL_DIR/opencctv"
  "$bin" --version >/dev/null 2>&1 || warn "The installed binary did not start. Please report this at https://github.com/${REPO}/issues"

  if [ "${OPENCCTV_NO_SERVICE:-0}" = "1" ]; then
    say "Installed. Start the server with: opencctv serve"
    return 0
  fi

  say "Setting up autostart"
  # The service starts "opencctv serve --data <dir>". The data directory must belong to the
  # user the service runs as, so it is created as that user before registering.
  if [ "$os" = "linux" ]; then
    if [ "$(id -u)" -eq 0 ]; then
      if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        home="$(getent passwd "$SUDO_USER" 2>/dev/null | cut -d: -f6)"
        [ -n "$home" ] || home="/home/$SUDO_USER"
        data="$home/.opencctv"
        mkdir -p "$data" && chown "$SUDO_USER:" "$data"
        "$bin" service install --data "$data" || service_failed
      else
        "$bin" service install || service_failed
      fi
    elif [ -n "$sudo" ]; then
      # System unit (starts at boot) that runs as you, with data in ~/.opencctv.
      mkdir -p "$HOME/.opencctv"
      $sudo "$bin" service install --data "$HOME/.opencctv" || service_failed
    else
      # No sudo: systemd user unit.
      "$bin" service install || service_failed
    fi
    # Pick up the new binary if the service was already running.
    $sudo systemctl restart opencctv.service >/dev/null 2>&1 || systemctl --user restart opencctv.service >/dev/null 2>&1 || true
  else
    # macOS: launchd agent for the logged-in user.
    if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
      sudo -u "$SUDO_USER" -H "$bin" service install || service_failed
    else
      "$bin" service install || service_failed
    fi
  fi

  ip=""
  if [ "$os" = "linux" ]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  else
    ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  [ -n "$ip" ] || ip="localhost"

  printf '\n'
  say "OpenCCTV is running."
  printf '    Open http://%s:8080 to create the admin account.\n' "$ip"
  printf '    Then install the app and scan the pairing code: https://opencctv.codext.de\n\n'
}

main "$@"
