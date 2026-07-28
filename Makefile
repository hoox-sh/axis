# Copyright (C) 2024-2026 jango_blockchained
# SPDX-License-Identifier: AGPL-3.0-only

.PHONY: help install dev test test-unit test-e2e typecheck worker-install worker-dev worker-typecheck worker-deploy build pages-deploy clean

help:
	@echo "AXIS development"
	@echo ""
	@echo "  install           bun install (app + worker)"
	@echo "  dev               Vite dev server :3000"
	@echo "  test              Unit + worker tests"
	@echo "  test-e2e          Playwright e2e"
	@echo "  typecheck         tsc (app + worker)"
	@echo "  worker-dev        wrangler dev :8787"
	@echo "  worker-deploy     Deploy Worker"
	@echo "  build             Production Vite build"
	@echo "  pages-deploy      Build + deploy Cloudflare Pages"
	@echo "  clean             Remove dist/coverage/test-results"

install:
	bun install
	cd worker && bun install

dev:
	@echo "AXIS on http://127.0.0.1:3000 — start pyne API with: (cd ../pyne && make run)"
	bun run dev

test:
	bun run test

test-unit:
	bun run test:unit

test-e2e:
	bun run test:e2e

typecheck:
	bunx tsc --noEmit
	cd worker && bun run typecheck

worker-install:
	cd worker && bun install

worker-dev:
	cd worker && bun run dev

worker-typecheck:
	cd worker && bun run typecheck

worker-deploy:
	cd worker && bun run deploy

build:
	bun run build

pages-deploy:
	bun run build
	bunx --yes wrangler pages deploy dist --project-name=pynescript-superchart

clean:
	rm -rf dist coverage test-results playwright-report .wrangler
