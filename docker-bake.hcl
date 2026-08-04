# Copyright (C) 2024-2026 jango_blockchained
# SPDX-License-Identifier: AGPL-3.0-only
#
# Docker Buildx Bake definitions for AXIS.
#
# One-time builder:
#   docker buildx create --name axis --driver docker-container --use
#   docker buildx inspect --bootstrap
#
# Usage:
#   docker buildx bake                     # → pwa (load into docker)
#   docker buildx bake pwa pwa-nginx
#   docker buildx bake pwa --print
#   REGISTRY=ghcr.io/hoox-sh TAG=v2.0.0 docker buildx bake pwa-release
#
# Env overrides:
#   REGISTRY  default ghcr.io/hoox-sh
#   TAG       default latest
#   PLATFORMS default linux/amd64 (local); release uses amd64+arm64
#   GIT_SHA   default dev
#   CACHE_DIR default /tmp/axis-buildx-cache

variable "REGISTRY" {
  default = "ghcr.io/hoox-sh"
}

variable "IMAGE_NAME" {
  default = "axis"
}

variable "TAG" {
  default = "latest"
}

variable "PLATFORMS" {
  default = "linux/amd64"
}

variable "BUN_VERSION" {
  default = "1.2.19"
}

variable "GIT_SHA" {
  default = "dev"
}

variable "CACHE_DIR" {
  default = "/tmp/axis-buildx-cache"
}

group "default" {
  targets = ["pwa"]
}

group "all" {
  targets = ["pwa", "pwa-nginx"]
}

group "release" {
  targets = ["pwa-release", "pwa-nginx-release"]
}

target "_common" {
  context    = "."
  dockerfile = "Dockerfile"
  args = {
    BUN_VERSION = BUN_VERSION
  }
  cache-from = ["type=local,src=${CACHE_DIR}"]
  cache-to   = ["type=local,dest=${CACHE_DIR},mode=max"]
}

target "pwa" {
  inherits   = ["_common"]
  target     = "pwa"
  tags       = [
    "${REGISTRY}/${IMAGE_NAME}:pwa",
    "${REGISTRY}/${IMAGE_NAME}:pwa-${TAG}",
    "axis-pwa:local",
  ]
  platforms  = [PLATFORMS]
  output     = ["type=docker"]
  labels = {
    "org.opencontainers.image.revision" = GIT_SHA
    "org.opencontainers.image.version"  = TAG
  }
}

target "pwa-nginx" {
  inherits   = ["_common"]
  target     = "pwa-nginx"
  tags       = [
    "${REGISTRY}/${IMAGE_NAME}:pwa-nginx",
    "${REGISTRY}/${IMAGE_NAME}:pwa-nginx-${TAG}",
    "axis-pwa-nginx:local",
  ]
  platforms  = [PLATFORMS]
  output     = ["type=docker"]
  labels = {
    "org.opencontainers.image.revision" = GIT_SHA
    "org.opencontainers.image.version"  = TAG
  }
}

# Multi-arch push to registry (requires buildx + login)
target "pwa-release" {
  inherits   = ["_common"]
  target     = "pwa"
  tags       = [
    "${REGISTRY}/${IMAGE_NAME}:pwa",
    "${REGISTRY}/${IMAGE_NAME}:pwa-${TAG}",
    "${REGISTRY}/${IMAGE_NAME}:pwa-sha-${GIT_SHA}",
  ]
  platforms  = ["linux/amd64", "linux/arm64"]
  output     = ["type=image,push=true"]
  labels = {
    "org.opencontainers.image.revision" = GIT_SHA
    "org.opencontainers.image.version"  = TAG
  }
}

target "pwa-nginx-release" {
  inherits   = ["_common"]
  target     = "pwa-nginx"
  tags       = [
    "${REGISTRY}/${IMAGE_NAME}:pwa-nginx",
    "${REGISTRY}/${IMAGE_NAME}:pwa-nginx-${TAG}",
    "${REGISTRY}/${IMAGE_NAME}:pwa-nginx-sha-${GIT_SHA}",
  ]
  platforms  = ["linux/amd64", "linux/arm64"]
  output     = ["type=image,push=true"]
  labels = {
    "org.opencontainers.image.revision" = GIT_SHA
    "org.opencontainers.image.version"  = TAG
  }
}
