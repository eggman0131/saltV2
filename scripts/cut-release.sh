#!/usr/bin/env bash
#
# Cut a production release.
#
# Creates and publishes a GitHub Release whose tag follows YYYYMM.X, where X
# auto-increments per calendar month: 202606.1, 202606.2, …, then 202607.1.
# Publishing the Release triggers .github/workflows/deploy-production.yml, which
# deploys the tagged commit to production *after* you approve the run in the
# `production` GitHub Environment. See docs/releases.md.
#
# Usage:
#   pnpm release          # tag main's current HEAD
#   pnpm release <ref>    # tag a specific branch / sha / tag instead of main
#   pnpm release -y       # skip the confirmation prompt
#
set -euo pipefail

target="main"
assume_yes=""
for arg in "$@"; do
  case "$arg" in
    -y | --yes) assume_yes=1 ;;
    *) target="$arg" ;;
  esac
done

ym="$(date +%Y%m)"

# Highest X already used this month. Checked against both published Releases and
# remote tags (the latter catches a tag left behind by a half-finished release).
# `max // 0` makes the first release of a month start at 1.
max_releases="$(gh release list --limit 200 --json tagName \
  --jq '[.[].tagName | select(test("^'"$ym"'\\.[0-9]+$")) | split(".")[1] | tonumber] | max // 0')"

max_tags="$(git ls-remote --tags origin 2>/dev/null \
  | sed -n 's#.*refs/tags/'"$ym"'\.\([0-9]\{1,\}\)$#\1#p' \
  | sort -n | tail -1 || true)"
max_tags="${max_tags:-0}"

next_x="$max_releases"
if [ "$max_tags" -gt "$next_x" ]; then next_x="$max_tags"; fi
next_x=$((next_x + 1))
tag="${ym}.${next_x}"

echo "Release tag : $tag"
echo "Target ref  : $target"
echo "On publish  : deploy-production.yml runs, then waits for your approval in the 'production' Environment."

if [ -z "$assume_yes" ]; then
  read -r -p "Create and publish this release? [y/N] " reply || reply=""
  case "$reply" in
    [yY] | [yY][eE][sS]) ;;
    *)
      echo "Aborted."
      exit 1
      ;;
  esac
fi

gh release create "$tag" --target "$target" --title "$tag" --generate-notes

echo
echo "Published $tag. Approve the deploy: Actions tab -> 'Deploy Production' -> Review deployments."
