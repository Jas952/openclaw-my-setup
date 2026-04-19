#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
RUN_DIR="$RUNTIME_DIR/run"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/load_env.sh"

SESSION_NAME="${SYMPHONY_SESSION_NAME:-symphony}"
DEFAULT_PORT="${SYMPHONY_PORT:-4010}"
OUT_FILE="$RUN_DIR/symphony.out"
WORKFLOW_PATH_DEFAULT="$RUNTIME_DIR/WORKFLOW.md"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/service.sh start [workflow_path] [-- symphony_args...]
  ./scripts/service.sh stop
  ./scripts/service.sh status
  ./scripts/service.sh logs
  ./scripts/service.sh restart [workflow_path] [-- symphony_args...]

Environment:
  SYMPHONY_SESSION_NAME  Screen session name (default: symphony)
  SYMPHONY_PORT          Fallback port if --port is not passed (default: 4010)
EOF
}

require_screen() {
  if ! command -v screen >/dev/null 2>&1; then
    echo "[error] 'screen' is required for detached service mode"
    echo "[hint]  Install it or run foreground mode: ./scripts/run.sh -- --port $DEFAULT_PORT"
    exit 1
  fi
}

session_exists() {
  local sessions
  sessions="$(screen -ls 2>/dev/null || true)"
  echo "$sessions" | grep -E "[[:space:]][0-9]+\\.${SESSION_NAME}[[:space:]]" >/dev/null 2>&1
}

port_pid() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $2}'
}

api_state() {
  local port="$1"
  curl -fsS "http://127.0.0.1:${port}/api/v1/state" 2>/dev/null || true
}

has_port_arg() {
  local arg
  for arg in "$@"; do
    if [ "$arg" = "--port" ] || [[ "$arg" == --port=* ]]; then
      return 0
    fi
  done
  return 1
}

start_service() {
  require_screen
  mkdir -p "$RUN_DIR"

  local workflow_path="$WORKFLOW_PATH_DEFAULT"
  if [ $# -gt 0 ] && [[ "${1}" != "--" ]] && [[ "${1#-}" == "$1" ]]; then
    workflow_path="$1"
    shift
  fi

  local extra_args=()
  if [ $# -gt 0 ] && [ "$1" = "--" ]; then
    shift
  fi
  if [ $# -gt 0 ]; then
    extra_args=("$@")
  fi

  if [ ${#extra_args[@]} -eq 0 ]; then
    extra_args=(--port "$DEFAULT_PORT")
  elif ! has_port_arg "${extra_args[@]}"; then
    extra_args=(--port "$DEFAULT_PORT" "${extra_args[@]}")
  fi

  local port="$DEFAULT_PORT"
  local i
  for ((i = 0; i < ${#extra_args[@]}; i++)); do
    if [ "${extra_args[$i]}" = "--port" ] && [ $((i + 1)) -lt ${#extra_args[@]} ]; then
      port="${extra_args[$((i + 1))]}"
      break
    fi
    if [[ "${extra_args[$i]}" == --port=* ]]; then
      port="${extra_args[$i]#--port=}"
      break
    fi
  done

  if session_exists; then
    echo "[warn] Screen session '$SESSION_NAME' already exists"
    status_service
    return 0
  fi

  local existing_pid
  existing_pid="$(port_pid "$port" || true)"
  if [ -n "$existing_pid" ]; then
    echo "[warn] Port 127.0.0.1:$port is already in use (pid: $existing_pid)"
    echo "[hint]  Stop existing process first: ./scripts/service.sh stop"
    return 1
  fi

  local cmd=(./scripts/run.sh "$workflow_path")
  if [ ${#extra_args[@]} -gt 0 ]; then
    cmd+=(-- "${extra_args[@]}")
  fi

  local quoted_cmd
  printf -v quoted_cmd '%q ' "${cmd[@]}"

  screen -dmS "$SESSION_NAME" bash -lc "cd '$ROOT_DIR' && ${quoted_cmd} >> '$OUT_FILE' 2>&1"
  echo "[ok] Detached session started: $SESSION_NAME"
  echo "[info] Logs: $OUT_FILE"

  local attempts=45
  local pid=""
  while [ "$attempts" -gt 0 ]; do
    pid="$(port_pid "$port" || true)"
    if [ -n "$pid" ]; then
      break
    fi
    attempts=$((attempts - 1))
    sleep 1
  done

  if [ -n "$pid" ]; then
    echo "[ok] Listening on 127.0.0.1:$port (pid: $pid)"
    local state
    state="$(api_state "$port")"
    if [ -n "$state" ]; then
      echo "[ok] API reachable: /api/v1/state"
    else
      echo "[warn] Port is open, but API did not answer yet"
    fi
  else
    echo "[warn] Service is starting in background; port not opened yet"
    echo "[hint]  Check status: ./scripts/service.sh status"
  fi
}

stop_service() {
  require_screen

  local stopped=0
  if session_exists; then
    screen -S "$SESSION_NAME" -X quit >/dev/null 2>&1 || true
    stopped=1
  fi

  if [ "$stopped" -eq 1 ]; then
    echo "[ok] Stopped session: $SESSION_NAME"
  else
    echo "[warn] Session '$SESSION_NAME' is not running"
  fi

  local pid
  pid="$(port_pid "$DEFAULT_PORT" || true)"
  if [ -n "$pid" ]; then
    local cmdline
    cmdline="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$cmdline" == *"/bin/symphony"* ]]; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
      if kill -0 "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
      echo "[ok] Stopped Symphony process on port $DEFAULT_PORT (pid: $pid)"
    else
      echo "[warn] Port $DEFAULT_PORT is used by non-Symphony process (pid: $pid), skipped"
    fi
  fi
}

status_service() {
  require_screen

  if session_exists; then
    echo "[ok] Session '$SESSION_NAME' is running"
  else
    echo "[warn] Session '$SESSION_NAME' is not running"
  fi

  local pid
  pid="$(port_pid "$DEFAULT_PORT" || true)"
  if [ -n "$pid" ]; then
    echo "[ok] Port 127.0.0.1:$DEFAULT_PORT is listening (pid: $pid)"
    local state
    state="$(api_state "$DEFAULT_PORT")"
    if [ -n "$state" ]; then
      echo "[ok] API: http://127.0.0.1:$DEFAULT_PORT/api/v1/state"
      echo "$state"
    else
      echo "[warn] API endpoint is not responding yet"
    fi
  else
    echo "[warn] Port 127.0.0.1:$DEFAULT_PORT is not listening"
  fi
}

logs_service() {
  mkdir -p "$RUN_DIR"
  touch "$OUT_FILE"
  tail -n 120 "$OUT_FILE"
}

main() {
  local cmd="${1:-}"
  if [ $# -gt 0 ]; then
    shift
  fi

  case "$cmd" in
    start)
      start_service "$@"
      ;;
    stop)
      stop_service
      ;;
    restart)
      stop_service
      start_service "$@"
      ;;
    status)
      status_service
      ;;
    logs)
      logs_service
      ;;
    "" | -h | --help | help)
      usage
      ;;
    *)
      echo "[error] Unknown command: $cmd"
      usage
      exit 1
      ;;
  esac
}

main "$@"
