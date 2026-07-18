#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it with: brew install node"
  exit 1
fi

npm install
npx playwright install chromium
npm run typecheck
npm test

echo
printf '%s\n' "Flow Studio Local installed successfully." "Start the mock portal with: npm run mock"
