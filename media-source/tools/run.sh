#!/usr/bin/env bash
# DiscVault Core, local demo stack for marketing screenshots.
#
#   run.sh start     start PostgreSQL (private cluster) + migrate + API
#   run.sh stop      stop API (+ worker) and PostgreSQL
#   run.sh status    show what is running
#   run.sh reset     wipe the database and artwork store, migrate, start (empty instance)
#   run.sh seed      create the owner "Alex Morgan" and load manifest.json  (seed_demo.py)
#   run.sh shots     take the screenshots                                    (shots.mjs)
#   run.sh all       reset + seed + shots
#   run.sh placeholders   regenerate placeholder posters/backdrops + manifest.json
#
# Nothing is written into the repository: the virtualenv, the PostgreSQL cluster,
# the artwork store, logs and screenshots all live next to this script.
# The repo is only read (PYTHONDONTWRITEBYTECODE keeps __pycache__ out of it).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${DV_REPO:?Set DV_REPO to a checkout of helmerzNL/DiscVault}"
BACKEND="$REPO/app/backend"
VENV="$HERE/venv"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="$HERE/pgdata"
PGPORT="${DV_PGPORT:-54329}"
API_PORT="${DV_API_PORT:-5055}"
DATA_DIR="$HERE/data"
LOGS="$HERE/logs"
DBNAME=discvault
DBUSER=discvault

export DV_REPO="$REPO"
export DV_BASE_URL="http://127.0.0.1:${API_PORT}"
export DATABASE_URL="postgresql://${DBUSER}@127.0.0.1:${PGPORT}/${DBNAME}"
# The session secret and the owner password are generated once per checkout
# into .demo-env (git-ignored); nothing secret is written in this script.
ENVFILE="$HERE/.demo-env"
if [ ! -f "$ENVFILE" ]; then
  (umask 077; printf 'JWT_SECRET=%s\nDV_OWNER_PASSWORD=%s\n' \
    "$(head -c 48 /dev/urandom | base64 | tr -d '/+=\n')" \
    "$(head -c 18 /dev/urandom | base64 | tr -d '/+=\n')Aa1!" > "$ENVFILE")
fi
set -a; . "$ENVFILE"; set +a
export LEGACY_AUTH_ENABLED=true            # password login + first-owner password bootstrap
export DISCVAULT_LEGACY_DATA_DIR="$DATA_DIR"   # artwork store: $DATA_DIR/media/...
export DISCVAULT_NEXT_ENABLE_TEST_RESET=false
export DISCVAULT_BLOCK_CRAWLERS=false
export BUILD_VERSION="${BUILD_VERSION:-26.11.0}"
export DISCVAULT_BACKEND_VERSION="$BUILD_VERSION"
export TZ="${TZ:-Europe/Amsterdam}"
export PYTHONDONTWRITEBYTECODE=1
export PYTHONWARNINGS=ignore
# RP_ID / RP_ORIGINS are deliberately NOT set: with no passkey configuration and a
# request on a local IP, the first-owner password bootstrap does not demand TOTP.
unset RP_ID RP_ORIGINS RP_ORIGIN || true
export DV_OWNER_USERNAME="${DV_OWNER_USERNAME:-alex}"
export DV_OWNER_DISPLAY_NAME="${DV_OWNER_DISPLAY_NAME:-Alex Morgan}"

# postgres refuses to run as root. Instead of touching the system cluster, run a
# private one inside a user namespace where root maps to an unprivileged uid.
if [ "$(id -u)" = "0" ]; then
  NS=(unshare -U --map-user=1000 --map-group=1000)
else
  NS=()
fi
PSQL=("$PGBIN/psql" -X -q "postgresql://${DBUSER}@127.0.0.1:${PGPORT}/postgres")

pg_running() { "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$PGPORT" 2>/dev/null; }
api_running() { curl -fs -o /dev/null --noproxy '*' "$DV_BASE_URL/api/next/health"; }

ensure_venv() {
  if [ ! -x "$VENV/bin/gunicorn" ]; then
    uv venv --python 3.13 "$VENV"
    uv pip install --python "$VENV/bin/python" -r "$BACKEND/requirements.txt"
  fi
}

start_pg() {
  mkdir -p "$LOGS"
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    "${NS[@]}" "$PGBIN/initdb" -D "$PGDATA" -U "$DBUSER" --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
  fi
  if ! pg_running; then
    "${NS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -l "$LOGS/postgres.log" -w \
      -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null
  fi
  if ! "${PSQL[@]}" -Atc "select 1 from pg_database where datname='$DBNAME'" | grep -q 1; then
    "${PSQL[@]}" -c "create database $DBNAME"
  fi
}

migrate() { (cd "$BACKEND" && "$VENV/bin/python" next_database.py migrate | tail -1); }

start_api() {
  if api_running; then echo "api already running on $DV_BASE_URL"; return; fi
  mkdir -p "$DATA_DIR" "$LOGS"
  # Offline by construction: every outbound request from the app is sent to a
  # closed local port, so MovieVault / TMDB / shops can never be reached and the
  # seeded library provably renders from local data only. DV_ONLINE=1 lifts it.
  local -a offline=()
  if [ "${DV_ONLINE:-0}" != "1" ]; then
    offline=(HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9
             http_proxy=http://127.0.0.1:9 ALL_PROXY= NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost)
  fi
  env "${offline[@]}" setsid nohup "$VENV/bin/gunicorn" --chdir "$BACKEND" \
    --bind "127.0.0.1:${API_PORT}" --workers 2 --timeout 180 \
    --pid "$HERE/api.pid" next_app:app >"$LOGS/api.log" 2>&1 &
  for _ in $(seq 1 60); do api_running && break; sleep 0.5; done
  api_running || { echo "API did not come up, see $LOGS/api.log"; tail -20 "$LOGS/api.log"; exit 1; }
  if [ "${DV_WITH_WORKER:-0}" = "1" ]; then
    # Not needed for the UI to render. Only background jobs (metadata refresh,
    # scheduled tasks, price sweeps) need it, and those want the network.
    (cd "$BACKEND" && env "${offline[@]}" DISCVAULT_WORKER_ID=demo-worker DISCVAULT_WORKER_POLL_INTERVAL=2 \
      setsid nohup "$VENV/bin/python" next_worker.py work >"$LOGS/worker.log" 2>&1 & echo $! >"$HERE/worker.pid")
  fi
  echo "web UI: $DV_BASE_URL/   (login: $DV_OWNER_USERNAME / $DV_OWNER_PASSWORD)"
}

stop_api() {
  for name in api worker; do
    if [ -f "$HERE/$name.pid" ]; then
      kill "$(cat "$HERE/$name.pid")" 2>/dev/null || true
      rm -f "$HERE/$name.pid"
    fi
  done
  pkill -f "gunicorn --chdir $BACKEND --bind 127.0.0.1:${API_PORT}" 2>/dev/null || true
  for _ in $(seq 1 20); do api_running || break; sleep 0.25; done
}

stop_pg() {
  if pg_running; then "${NS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null; fi
}

case "${1:-}" in
  start)
    ensure_venv; start_pg; migrate; start_api ;;
  stop)
    stop_api; stop_pg; echo stopped ;;
  status)
    pg_running && echo "postgres: up on 127.0.0.1:$PGPORT ($("${PSQL[@]}" -Atc 'show server_version'))" || echo "postgres: down"
    api_running && echo "api: up on $DV_BASE_URL" || echo "api: down" ;;
  reset)
    ensure_venv; stop_api; start_pg
    "${PSQL[@]}" -c "drop database if exists $DBNAME with (force)" -c "create database $DBNAME"
    rm -rf "$DATA_DIR"; mkdir -p "$DATA_DIR"
    migrate; start_api ;;
  seed)
    api_running || { echo "start the stack first: $0 start"; exit 1; }
    shift
    "$VENV/bin/python" "$HERE/seed_demo.py" --manifest "${DV_MANIFEST:-$HERE/manifest.json}" "$@" ;;
  shots)
    api_running || { echo "start the stack first: $0 start"; exit 1; }
    shift
    (cd "$HERE" && node shots.mjs "$@") ;;
  placeholders)
    ensure_venv; "$VENV/bin/python" "$HERE/make_placeholders.py" --out "$HERE" ;;
  all)
    "$0" reset; "$0" seed; "$0" shots ;;
  *)
    sed -n '2,12p' "$0"; exit 2 ;;
esac
