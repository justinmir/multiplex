#!/usr/bin/env bash
# Run a command that needs a display. If $DISPLAY is set (desktop), run it
# directly. Otherwise (headless CI/agent on Linux) wrap it in xvfb-run.
#
# Usage: scripts/with-display.sh <command> [args...]
#   e.g. scripts/with-display.sh npx playwright test ./tests/e2e.spec.ts
set -euo pipefail

if [ -n "${DISPLAY:-}" ]; then
  exec "$@"
elif command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a -s "-screen 0 1920x1080x24" "$@"
else
  echo "with-display: no DISPLAY and xvfb-run not found." >&2
  echo "Install xvfb (Debian/Ubuntu: 'sudo apt-get install xvfb') or run on a machine with a display." >&2
  exit 1
fi
