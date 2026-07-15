#!/usr/bin/env bash
# Build the deckyojp plugin into out/deckyojp.zip — entirely in Docker, so
# nothing is installed on the host.
#
#   ./build-plugin.sh            # frontend only (fast; py_modules stays empty)
#   ./build-plugin.sh --deps     # also vendor Python deps into py_modules/
#                                 #  (built in holo-base = the SteamOS env)
#
# --deps is slow the first time (pulls holo-base + ~250 MB of wheels). Use the
# fast build to first confirm the plugin loads and the UI works (backend imports
# are lazy, so OCR just errors until deps are present), then run --deps.
set -euo pipefail
cd "$(dirname "$0")"

PLUGIN="deckyojp"
STAGE="out/${PLUGIN}"

echo ">> Building frontend (node:22-alpine)…"
docker run --rm -v "$PWD":/app -w /app node:22-alpine \
  sh -c "corepack enable && pnpm install && pnpm build"

if [ "${1:-}" = "--deps" ]; then
  # Decky runs plugin backends under its OWN frozen interpreter bundled in
  # /home/deck/homebrew/services/PluginLoader — Python 3.11 (NOT SteamOS's
  # system python). So deps must be cp311 x86_64: python:3.11-slim pinned to
  # linux/amd64 so pip pulls cp311 manylinux x86_64 wheels, even on an arm64 Mac.
  echo ">> Vendoring Python deps into py_modules/ (python:3.11-slim, linux/amd64)…"
  rm -rf py_modules py_modules.tgz
  # Install inside the container (container-local dir avoids pip's cross-device
  # rename bug), then emit ONE tarball onto the bind mount. Thousands of small
  # writes straight to a macOS bind mount are unreliable under amd64 emulation;
  # a single-file write + native host-side extract is robust.
  docker run --rm --platform linux/amd64 -v "$PWD":/plugin -w /plugin \
    python:3.11-slim \
    sh -c "python --version && \
           pip install --target=/opt/pm -r requirements.txt && \
           tar czf /plugin/py_modules.tgz -C /opt/pm ."
  mkdir -p py_modules && tar xzf py_modules.tgz -C py_modules && rm -f py_modules.tgz
  echo ">> py_modules populated: $(ls py_modules | wc -l | tr -d ' ') entries"
  # Sanity: numpy's C-extension must be cp311 (Decky's bundled interpreter),
  # else the plugin fails to import numpy on the Deck. Fail loudly if not.
  if ! ls py_modules/numpy/_core/_multiarray_umath.cpython-311-*.so >/dev/null 2>&1; then
    echo "!! ERROR: numpy C-extension is not cpython-311 — wrong Python built the wheels:" >&2
    ls py_modules/numpy/_core/_multiarray_umath*.so >&2 2>/dev/null || true
    exit 1
  fi
  echo ">> verified numpy is cpython-311 ✓"
fi

echo ">> Staging plugin files…"
rm -rf "$STAGE" && mkdir -p "$STAGE"
cp -r plugin.json package.json main.py dist "$STAGE"/
[ -d assets ] && cp -r assets "$STAGE"/ || true
if [ -d py_modules ] && [ -n "$(ls -A py_modules 2>/dev/null | grep -v '^.keep$' || true)" ]; then
  cp -r py_modules "$STAGE"/
fi

echo ">> Zipping…"
( cd out && rm -f "${PLUGIN}.zip" && zip -qr "${PLUGIN}.zip" "${PLUGIN}" )
echo ">> Done: out/${PLUGIN}.zip  ($(du -h "out/${PLUGIN}.zip" | cut -f1))"
