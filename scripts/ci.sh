#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

step() { echo -e "\n${YELLOW}▶ $1${NC}"; }
pass() { echo -e "${GREEN}✔ $1${NC}"; }
fail() { echo -e "${RED}✖ $1${NC}"; exit 1; }

cd "$(git rev-parse --show-toplevel)"

step "Installing dependencies"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pass "Dependencies installed"

step "Building shared package"
pnpm --filter @agentim/shared build || fail "shared build failed"
pass "Shared package built"

step "Building server"
pnpm --filter @agentim/server build || fail "server build failed"
pass "Server built"

step "Building web"
pnpm --filter @agentim/web build || fail "web build failed"
pass "Web built"

step "Building gateway"
pnpm --filter agentim build || fail "gateway build failed"
pass "Gateway built"

step "Running tests"
pnpm test || fail "Tests failed"
pass "All tests passed"

echo -e "\n${GREEN}✔ All CI checks passed!${NC}"
