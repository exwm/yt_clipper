#!/usr/bin/env bash
# Usage: verify-sha256.sh FILE EXPECTED_SHA256
# Fails when FILE's sha256 differs from the one pinned in the workflow, and prints both: a version
# bump updates the pin from the printed value after checking it against the project's release.
set -euo pipefail
actual=$( (sha256sum "$1" 2>/dev/null || shasum -a 256 "$1") | cut -d' ' -f1)
if [ "$actual" != "$2" ]; then
  echo "::error::sha256 of $1 is $actual, expected $2"
  exit 1
fi
echo "sha256 of $1 matches"
