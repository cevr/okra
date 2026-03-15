#!/usr/bin/env bash
# Creates a self-contained test repo for okra research with codex provider at /tmp/okra-research-fixture-codex
set -euo pipefail

DIR="/tmp/okra-research-fixture-codex"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"

git init
git checkout -b main

# Copy fixture files
cp "$SCRIPT_DIR/subject.ts" .
cp "$SCRIPT_DIR/bench.ts" .
chmod +x bench.ts

git add -A
git commit -m "initial: naive implementations"

echo ""
echo "Fixture repo created at: $DIR"
echo ""
echo "Test with:"
echo "  cd $DIR"
echo "  okra research start --name optimize --unit ms --direction min --benchmark 'bun bench.ts' --objective 'optimize all functions for speed' --provider codex"
