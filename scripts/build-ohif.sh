#!/usr/bin/env bash
# Build OHIF (the pinned release) with radiarch's viewer packages in its workspace: the check that they build against
# that release, and the static app the standalone viewer serves. Needs git, Node >= 24 and npx (pnpm).
#
#   scripts/build-ohif.sh [work dir]             # clone the release into [work dir] (default: a new temporary
#                                                # directory), add the packages, install, build; prints the dist path
#   OHIF_DIR=/path/to/Viewers scripts/build-ohif.sh
#                                                # an existing OHIF checkout in place of the clone: the packages are
#                                                # added to it and it is built there
#   scripts/build-ohif.sh --add-only /path/to/Viewers
#                                                # only add and register the packages in that checkout; no install, no
#                                                # build (one OHIF installation that holds several projects' extensions
#                                                # installs and builds once, after each has added its own)
#
# An existing checkout should be at the pinned release.
#
# Several GB of memory and about ten minutes: run it in CI, or locally when the machine is free.
set -euo pipefail

OHIF_VERSION="${OHIF_VERSION:-v3.13.13}"
VIEWER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADD_ONLY=0
if [ "${1:-}" = "--add-only" ]; then
  [ -n "${2:-}" ] || { echo "usage: $0 --add-only OHIF_DIR" >&2; exit 2; }
  ADD_ONLY=1
  OHIF_DIR="$2"
fi

if [ -n "${OHIF_DIR:-}" ]; then
  OHIF="$(cd "$OHIF_DIR" 2>/dev/null && pwd)" || { echo "OHIF_DIR $OHIF_DIR: no such directory" >&2; exit 2; }
  if [ ! -f "$OHIF/platform/app/pluginConfig.json" ]; then
    echo "OHIF_DIR $OHIF: not an OHIF checkout (no platform/app/pluginConfig.json)" >&2
    exit 2
  fi
else
  WORK="${1:-$(mktemp -d)}"
  OHIF="$WORK/Viewers"
  if [ ! -d "$OHIF/.git" ]; then
    git clone --quiet --depth 1 --branch "$OHIF_VERSION" https://github.com/OHIF/Viewers.git "$OHIF"
  fi
fi

# radiarch's packages join OHIF's pnpm workspace as radiarch-<name>: the libraries and extensions under extensions/,
# the modes under modes/ (OHIF's workspace lists those two folders)
copy_pkg() {  # source folder, destination folder in OHIF
  rm -rf "$2"; mkdir -p "$2"
  if git -C "$1" rev-parse --git-dir >/dev/null 2>&1; then
    (cd "$1" && git ls-files -z --cached --others --exclude-standard . | tar --null -T - -cf -) | tar -xf - -C "$2"
  else  # a copy without git (a build context): everything but build output
    tar -C "$1" --exclude=node_modules --exclude=dist -cf - . | tar -xf - -C "$2"
  fi
}
for pkg in "$VIEWER"/libs/*/ "$VIEWER"/extensions/*/; do
  [ -f "$pkg/package.json" ] && copy_pkg "$pkg" "$OHIF/extensions/radiarch-$(basename "$pkg")"
done
for pkg in "$VIEWER"/modes/*/; do
  [ -f "$pkg/package.json" ] && copy_pkg "$pkg" "$OHIF/modes/radiarch-$(basename "$pkg")"
done

# registered with the app once: the extensions as non-default ones (the mode asks for them), the modes listed
python3 - "$OHIF/platform/app/pluginConfig.json" "$VIEWER" <<'PY'
import json, pathlib, sys
cfg_path, here = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
cfg = json.loads(cfg_path.read_text())
for kind in ("extensions", "modes"):
    have = {e["packageName"] for e in cfg[kind]}
    for pj in sorted((here / kind).glob("*/package.json")):
        pkg = json.loads(pj.read_text())
        if pkg["name"] in have:
            continue
        entry = {"packageName": pkg["name"]}
        if kind == "extensions":
            entry.update({"default": False, "version": pkg["version"]})
        cfg[kind].append(entry)
cfg_path.write_text(json.dumps(cfg, indent=2) + "\n")
PY

if [ "$ADD_ONLY" = 1 ]; then
  echo "radiarch packages added to $OHIF"
  exit 0
fi

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
