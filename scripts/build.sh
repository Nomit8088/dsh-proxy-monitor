#!/bin/bash
# Build wrapper — delegates to the cross-platform Node build script.
#
# Exists so the DSH plugin toolchain (scripts/build.sh convention) and anyone
# working from a POSIX shell can call the same entry point as `npm run build`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node scripts/build.mjs
