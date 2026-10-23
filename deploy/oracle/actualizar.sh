#!/usr/bin/env bash
# Publica la ultima version del repositorio: descarga los cambios y recompila la imagen.
set -euo pipefail
cd "$(dirname "$0")"
git pull --ff-only
sudo docker compose up -d --build
sudo docker image prune -f >/dev/null
sudo docker compose ps
