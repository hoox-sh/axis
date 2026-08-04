# Copyright (C) 2024-2026 jango_blockchained
# SPDX-License-Identifier: AGPL-3.0-only

.PHONY: help install dev test test-unit test-e2e typecheck worker-install worker-dev worker-typecheck worker-deploy build pages-deploy clean \
	docker-builder docker-bake docker-bake-all docker-up docker-up-api docker-up-proxy docker-down docker-logs docker-ps docker-push

GIT_SHA ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
export GIT_SHA

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
	@echo ""
	@echo "Docker (Buildx + Compose)"
	@echo "  docker-builder    Create/use buildx builder 'axis'"
	@echo "  docker-bake       buildx bake pwa → axis-pwa:local"
	@echo "  docker-bake-all   bake pwa + pwa-nginx"
	@echo "  docker-up         compose up PWA on :8081"
	@echo "  docker-up-api     compose --profile api (PWA + pyne :5002)"
	@echo "  docker-up-proxy   compose --profile proxy (nginx :8080 + api)"
	@echo "  docker-down       compose down"
	@echo "  docker-logs       compose logs -f"
	@echo "  docker-ps         compose ps"
	@echo "  docker-push       bake release (multi-arch push; needs login)"

install:
	bun install
	cd worker && bun install

dev:
	@echo "AXIS on http://127.0.0.1:3000 — start pyne API with: (cd ../pynescript && make run)"
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
	bunx --yes wrangler pages deploy dist --project-name=pynescript-axis

clean:
	rm -rf dist coverage test-results playwright-report .wrangler

# ── Docker Buildx / Compose ─────────────────────────────────────────

docker-builder:
	@docker buildx inspect axis >/dev/null 2>&1 || \
		docker buildx create --name axis --driver docker-container --use
	@docker buildx use axis
	@docker buildx inspect --bootstrap
	@echo "builder: axis (ready)"

docker-bake: docker-builder
	docker buildx bake -f docker-bake.hcl pwa

docker-bake-all: docker-builder
	docker buildx bake -f docker-bake.hcl all

docker-up:
	docker compose up --build -d
	@echo "PWA → http://127.0.0.1:$${AXIS_PORT:-8081}"

docker-up-api:
	@test -d "$${PYNE_ROOT:-../pynescript}" || \
		(echo "error: PYNE_ROOT=$${PYNE_ROOT:-../pynescript} not found (sister pyne/pynescript repo)" >&2; exit 1)
	docker compose --profile api up --build -d
	@echo "PWA → http://127.0.0.1:$${AXIS_PORT:-8081}"
	@echo "API → http://127.0.0.1:$${API_PORT:-5002}"

docker-up-proxy:
	@test -d "$${PYNE_ROOT:-../pynescript}" || \
		(echo "error: PYNE_ROOT=$${PYNE_ROOT:-../pynescript} not found" >&2; exit 1)
	docker compose --profile proxy up --build -d
	@echo "Proxy (same-origin /run) → http://127.0.0.1:$${PROXY_PORT:-8080}"

docker-down:
	docker compose --profile api --profile proxy down

docker-logs:
	docker compose logs -f --tail=200

docker-ps:
	docker compose ps

docker-push: docker-builder
	@echo "Pushing multi-arch images (REGISTRY/TAG from env)…"
	GIT_SHA=$(GIT_SHA) docker buildx bake -f docker-bake.hcl release
