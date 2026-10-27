#!/usr/bin/env bash
# Воспроизведение ассетов Blender. BLENDER_PY — Python с модулем bpy 4.3 (pip install bpy==4.3.0 под Python 3.11)
# или полноценный Blender: BLENDER="blender -b --python". По умолчанию ищется .venv-blender/bin/python.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ -n "${BLENDER:-}" ]]; then
  run() { $BLENDER "$1"; }
else
  PY="${BLENDER_PY:-.venv-blender/bin/python}"
  if [[ ! -x "$PY" ]]; then
    echo "Создаю .venv-blender (Python 3.11 + bpy 4.3.0)…"
    python3.11 -m venv .venv-blender
    .venv-blender/bin/pip install -q bpy==4.3.0 "numpy<2"
    PY=.venv-blender/bin/python
  fi
  run() { "$PY" "$1"; }
fi
run scripts/blender/make_textures.py
run scripts/blender/make_architecture.py
run scripts/blender/make_wc.py
if [[ -f artifacts/house-architecture.glb ]]; then
  run scripts/blender/make_house_blend.py
else
  echo "artifacts/house-architecture.glb нет — сначала: npm run export:glb (экспорт браузерной архитектуры)"
fi
if [[ -f artifacts/vsevolozhsk-site.glb ]]; then
  run scripts/blender/make_site_blend.py
else
  echo "artifacts/vsevolozhsk-site.glb нет — сначала: npm run export:site (экспорт сцены участка)"
fi
