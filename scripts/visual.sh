#!/usr/bin/env bash
# Visual regression di container Playwright resmi, terhadap stack Docker Compose yang sudah berjalan.
#
#   docker compose up -d --build --wait
#   pnpm test:visual            # bandingkan dengan baseline di tests/visual/__screenshots__
#   pnpm test:visual:update     # tulis ulang baseline yang berubah (periksa gambarnya sebelum commit)
#
# Argumen tambahan diteruskan ke `playwright test` (mis. `-g dashboard`). Baseline hanya sah bila dibuat di container
# ini: render font di host berbeda. Versi image mengikuti @playwright/test di pnpm-lock.yaml.
#
# Dependensi dipasang di dalam container (node_modules host dibuat untuk OS lain dan tidak bisa dipakai), ke volume
# bernama agar run berikutnya cepat dan node_modules host tidak tersentuh. Mengosongkan volume bila instalasi rusak:
# docker volume rm testpulse-visual-nm-root testpulse-visual-nm-tests testpulse-visual-nm-shared testpulse-visual-pnpm-store
#
# Windows: jalankan dari Git Bash (script ini memakai bash, `pwd -W`, dan MSYS_NO_PATHCONV); `pnpm test:visual` memanggil
# `bash`, jadi Git Bash harus lebih dulu di PATH daripada bash.exe milik WSL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Git Bash di Windows: docker.exe belum tentu ada di PATH, dan path volume harus berbentuk Windows (C:/...).
if ! command -v docker >/dev/null 2>&1 && [ -d "/c/Program Files/Docker/Docker/resources/bin" ]; then
  export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"
fi
export MSYS_NO_PATHCONV=1
MOUNT_ROOT="$(pwd -W 2>/dev/null || pwd)"

PLAYWRIGHT_VERSION="$(awk "/^      '@playwright\/test':/{f=1} f&&/version:/{print \$2; exit}" pnpm-lock.yaml)"
PNPM_VERSION="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' package.json)"
if [ -z "$PLAYWRIGHT_VERSION" ] || [ -z "$PNPM_VERSION" ]; then
  echo "Tidak bisa membaca versi @playwright/test (pnpm-lock.yaml) atau pnpm (package.json)." >&2
  exit 1
fi
IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble"

NETWORK="${COMPOSE_NETWORK:-testpulse_default}"
if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "Network $NETWORK tidak ada. Jalankan dulu: docker compose up -d --build --wait" >&2
  exit 1
fi

ARGS=()
case "${1:-}" in
  --update) shift; ARGS+=(--update-snapshots) ;;
esac

echo "Image: $IMAGE (pnpm $PNPM_VERSION)"

# Skrip di dalam container. File yang ditulis container (baseline, test-results) dimiliki root; trap EXIT mengembalikan
# kepemilikannya ke pengguna host apa pun hasilnya (install gagal, test gagal, atau dihentikan), supaya di Linux file itu
# tetap bisa diubah atau dihapus tanpa sudo.
read -r -d '' INNER <<'EOF' || true
set -uo pipefail
trap 'chown -R "$HOST_UID:$HOST_GID" /work/tests/test-results /work/tests/visual /work/tests/allure-results /work/tests/playwright-report 2>/dev/null || true' EXIT
npm install --global --silent "pnpm@$PNPM_VERSION" || exit 1
cd /work
pnpm install --frozen-lockfile --ignore-scripts --reporter=silent --store-dir /pnpm-store --filter "@testpulse/tests..." || exit 1
cd tests
npx playwright test --project=visual "$@"
EOF

# Titik mount dibuat lebih dulu oleh pengguna host; bila tidak, Docker membuatnya sebagai root.
mkdir -p node_modules tests/node_modules packages/shared/node_modules

# node_modules dari volume bernama menutupi node_modules host pada tiga lokasi yang disentuh `pnpm install --filter`.
# --init: proses 1 yang benar (menuai proses anak browser, meneruskan sinyal); --ipc=host: anjuran Playwright untuk Chromium.
exec docker run --rm --init \
  --network "$NETWORK" \
  -v "$MOUNT_ROOT:/work" \
  -v testpulse-visual-nm-root:/work/node_modules \
  -v testpulse-visual-nm-tests:/work/tests/node_modules \
  -v testpulse-visual-nm-shared:/work/packages/shared/node_modules \
  -v testpulse-visual-pnpm-store:/pnpm-store \
  -e BASE_URL="${BASE_URL_IN_NETWORK:-http://web:8080}" \
  -e PNPM_VERSION="$PNPM_VERSION" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  ${CI:+-e CI="$CI"} \
  ${JUNIT_NAME:+-e JUNIT_NAME="$JUNIT_NAME"} \
  --ipc=host \
  -w /work \
  "$IMAGE" \
  bash -c "$INNER" visual ${ARGS[@]+"${ARGS[@]}"} "$@"
