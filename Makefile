# Copyright (C) 2024-2026 jango_blockchained
# SPDX-License-Identifier: AGPL-3.0-only

.PHONY: help install dev test test-unit test-e2e typecheck worker-install worker-dev worker-typecheck worker-deploy build pages-deploy clean \
	docker-builder docker-bake docker-bake-all docker-bake-nginx docker-up docker-up-api docker-up-proxy docker-up-prod \
	docker-down docker-logs docker-ps docker-push docker-pull docker-rebuild docker-shell docker-health docker-smoke docker-clean \
	axis axis-install axis-doctor axis-setup axis-deploy axis-health

GIT_SHA ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
VERSION ?= $(shell node -p "require('./package.json').version" 2>/dev/null || echo 2.0.0)
export GIT_SHA
export VERSION

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
	@echo "AXIS CLI (packages/cli)"
	@echo "  axis              bun packages/cli/bin/axis.js …"
	@echo "  axis-install      Install app + worker + CLI deps"
	@echo "  axis-doctor       Toolchain / wrangler diagnostics"
	@echo "  axis-setup        Bootstrap wrangler / D1 / OAuth"
	@echo "  axis-deploy       Deploy Worker (axis deploy worker)"
	@echo "  axis-health       Probe deployed Worker /health"
	@echo ""
	@echo "Docker (Buildx + Compose)"
	@echo "  docker-builder    Create/use buildx builder 'axis'"
	@echo "  docker-bake       buildx bake pwa → axis-pwa:local"
	@echo "  docker-bake-nginx bake pwa-nginx only"
	@echo "  docker-bake-all   bake pwa + pwa-nginx"
	@echo "  docker-up         compose up PWA on :8081"
	@echo "  docker-up-api     compose --profile api (PWA + pyne :5002)"
	@echo "  docker-up-proxy   compose --profile proxy (nginx :8080 + api)"
	@echo "  docker-up-prod    compose + prod overrides (pull_policy missing)"
	@echo "  docker-rebuild    down + bake pwa + up -d"
	@echo "  docker-shell      shell into running pwa container"
	@echo "  docker-health     curl local PWA / and optional API /health"
	@echo "  docker-smoke      bake (if needed) + up + health"
	@echo "  docker-pull       pull AXIS_IMAGE / AXIS_NGINX_IMAGE"
	@echo "  docker-clean      compose down -v + prune dangling images"
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
	cd packages/cli && bun run typecheck

worker-install:
	cd worker && bun install

worker-dev:
	cd worker && bun run dev

worker-typecheck:
	cd worker && bun run typecheck

worker-deploy:
	cd worker && bun run deploy

# ── AXIS CLI ────────────────────────────────────────────────────────

axis:
	bun packages/cli/bin/axis.js $(ARGS)

axis-install:
	bun packages/cli/bin/axis.js install

axis-doctor:
	bun packages/cli/bin/axis.js doctor $(ARGS)

axis-setup:
	bun packages/cli/bin/axis.js setup $(ARGS)

axis-deploy:
	bun packages/cli/bin/axis.js deploy worker $(ARGS)

axis-health:
	bun packages/cli/bin/axis.js health $(ARGS)

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
	@docker buildx inspect --bootstrap >/dev/null
	@echo "builder: axis (ready)"

docker-bake: docker-builder
	GIT_SHA=$(GIT_SHA) VERSION=$(VERSION) docker buildx bake -f docker-bake.hcl pwa
	@echo "image: axis-pwa:local (sha=$(GIT_SHA))"

docker-bake-nginx: docker-builder
	GIT_SHA=$(GIT_SHA) VERSION=$(VERSION) docker buildx bake -f docker-bake.hcl pwa-nginx

docker-bake-all: docker-builder
	GIT_SHA=$(GIT_SHA) VERSION=$(VERSION) docker buildx bake -f docker-bake.hcl all

docker-up:
	GIT_SHA=$(GIT_SHA) VERSION=$(VERSION) docker compose up --build -d
	@echo "PWA → http://127.0.0.1:$${AXIS_PORT:-8081}"

docker-up-api:
	@test -d "$${PYNE_ROOT:-../pynescript}" || \
		(echo "error: PYNE_ROOT=$${PYNE_ROOT:-../pynescript} not found (sister pyne/pynescript repo)" >&2; exit 1)
	GIT_SHA=$(GIT_SHA) VERSION=$(VERSION) docker compose --profile api up --build -d
	@echo "PWA → http://127.0.0.1:$${AXIS_PORT:-8081}"
	@echo "API → http://127.0.0.1:$${API_PORT:-5002}"

docker-up-proxy:
	@test -d "$${PYNE_ROOT:-../pynescript}" || \
		(echo "error: PYNE_ROOT=$${PYNE_ROOT:-../pynescript} not found" >&2; exit 1)
	GIT_SHA=$(GIT_SHA) VERSION=$(VERSION) docker compose --profile proxy up --build -d
	@echo "Proxy (same-origin /run) → http://127.0.0.1:$${PROXY_PORT:-8080}"

docker-up-prod:
	GIT_SHA=$(GIT_SHA) VERSION=$(VERSION) docker compose \
		-f docker-compose.yml -f docker-compose.prod.yml up --build -d
	@echo "PWA (prod compose) → http://127.0.0.1:$${AXIS_PORT:-8081}"

docker-rebuild: docker-down docker-bake
	GIT_SHA=$(GIT_SHA) VERSION=$(VERSION) docker compose up -d
	@$(MAKE) docker-health

docker-shell:
	@cid=$$(docker compose ps -q pwa); \
	if [ -z "$$cid" ]; then echo "error: pwa not running (make docker-up)" >&2; exit 1; fi; \
	docker exec -it $$cid sh -c 'command -v bash >/dev/null && exec bash || exec sh'

docker-health:
	@port=$${AXIS_PORT:-8081}; \
	echo -n "pwa :$$port → "; \
	curl -fsS -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$$port/" || echo "down"; \
	if docker compose ps --status running --services 2>/dev/null | grep -qx api; then \
	  aport=$${API_PORT:-5002}; \
	  echo -n "api :$$aport → "; \
	  curl -fsS -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$$aport/health" || echo "down"; \
	fi

docker-smoke: docker-bake
	GIT_SHA=$(GIT_SHA) VERSION=$(VERSION) docker compose up -d
	@sleep 2
	@$(MAKE) docker-health
	@echo "smoke ok"

docker-pull:
	@img=$${AXIS_IMAGE:-ghcr.io/hoox-sh/axis:pwa-latest}; \
	echo "pull $$img"; docker pull $$img
	@nimg=$${AXIS_NGINX_IMAGE:-ghcr.io/hoox-sh/axis:pwa-nginx-latest}; \
	echo "pull $$nimg"; docker pull $$nimg || true

docker-clean:
	docker compose --profile api --profile proxy down -v --remove-orphans || true
	@docker image prune -f >/dev/null
	@echo "compose volumes removed; dangling images pruned"

docker-down:
	docker compose --profile api --profile proxy down

docker-logs:
	docker compose logs -f --tail=200

docker-ps:
	docker compose ps

docker-push: docker-builder
	@echo "Pushing multi-arch images (REGISTRY/TAG from env)…"
	GIT_SHA=$(GIT_SHA) VERSION=$(VERSION) docker buildx bake -f docker-bake.hcl release
