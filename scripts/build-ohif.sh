#!/usr/bin/env bash
# Build OHIF (the pinned release) with radiarch's viewer packages in its workspace: the check that they build against
# that release, and the static app the standalone viewer serves (R13.2d). Needs git, Node >= 24 and corepack (pnpm).
#
#   viewer/scripts/build-ohif.sh [work dir]      # default: a new temporary directory; prints the dist path
#
# Several GB of memory and about ten minutes: run it in CI, or locally when the machine is free.
set -euo pipefail

OHIF_VERSION="${OHIF_VERSION:-v3.13.13}"
VIEWER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-$(mktemp -d)}"
OHIF="$WORK/Viewers"

if [ ! -d "$OHIF/.git" ]; then
  git clone --quiet --depth 1 --branch "$OHIF_VERSION" https://github.com/OHIF/Viewers.git "$OHIF"
fi

# radiarch's packages join OHIF's pnpm workspace (extensions/*)
rm -rf "$OHIF/extensions/radiarch-rt-dose-core" "$OHIF/extensions/radiarch-ohif-extension-rt-dose"
cp -r "$VIEWER/rt-dose-core" "$OHIF/extensions/radiarch-rt-dose-core"
cp -r "$VIEWER/ohif-extension-rt-dose" "$OHIF/extensions/radiarch-ohif-extension-rt-dose"

# registered with the app; not a default extension, a mode asks for it
python3 - "$OHIF/platform/app/pluginConfig.json" <<'PY'
import json, sys
p = sys.argv[1]
cfg = json.load(open(p))
names = {e["packageName"] for e in cfg["extensions"]}
if "@radiarch/ohif-extension-rt-dose" not in names:
    cfg["extensions"].append({"packageName": "@radiarch/ohif-extension-rt-dose", "default": False, "version": "0.1.0"})
json.dump(cfg, open(p, "w"), indent=2)
PY

cd "$OHIF"
# the pnpm OHIF pins (packageManager), whatever pnpm is on the PATH; through npx, as corepack before 0.35 cannot
# unpack pnpm 12
PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")"
PNPM=(npx --yes "pnpm@$PNPM_VERSION")
"${PNPM[@]}" --version
# the workspace gains packages, so the lockfile changes
"${PNPM[@]}" install --no-frozen-lockfile --config.minimumReleaseAge=0 --reporter=append-only
"${PNPM[@]}" run build      # build:ci also bumps OHIF's release version; not ours to do
echo "$OHIF/platform/app/dist"
