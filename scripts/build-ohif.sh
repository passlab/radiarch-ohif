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

# radiarch's packages join OHIF's pnpm workspace: libraries and extensions under extensions/, the mode under modes/
for pkg in rt-dose-core radiarch-client ohif-extension-rt-dose ohif-extension-radiarch; do
  rm -rf "$OHIF/extensions/radiarch-$pkg"
  cp -r "$VIEWER/$pkg" "$OHIF/extensions/radiarch-$pkg"
done
rm -rf "$OHIF/modes/radiarch-plan-review"
cp -r "$VIEWER/ohif-mode-plan-review" "$OHIF/modes/radiarch-plan-review"

# registered with the app: the extensions are not default ones (the mode asks for them); the mode is listed
python3 - "$OHIF/platform/app/pluginConfig.json" <<'PY'
import json, sys
p = sys.argv[1]
cfg = json.load(open(p))
have = {e["packageName"] for e in cfg["extensions"]}
for name in ("@radiarch/ohif-extension-rt-dose", "@radiarch/ohif-extension-radiarch"):
    if name not in have:
        cfg["extensions"].append({"packageName": name, "default": False, "version": "0.1.0"})
if "@radiarch/mode-plan-review" not in {m["packageName"] for m in cfg["modes"]}:
    cfg["modes"].append({"packageName": "@radiarch/mode-plan-review"})
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
