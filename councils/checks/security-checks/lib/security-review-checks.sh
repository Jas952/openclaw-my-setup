#!/usr/bin/env bash

set -euo pipefail

: "${WORKSPACE_ROOT:?WORKSPACE_ROOT is required}"
: "${FINDINGS_FILE:?FINDINGS_FILE is required}"
: "${OPENCLAW_ROOT:?OPENCLAW_ROOT is required}"

SECURITY_REVIEW_CONFIG="${SECURITY_REVIEW_CONFIG:-$WORKSPACE_ROOT/security-review.config.json}"

add_finding() {
  local severity="$1"
  local check_id="$2"
  local title="$3"
  local details="$4"
  local evidence="${5:-}"

  details="$(echo "$details" | tr '\n\r\t' '   ')"
  evidence="$(echo "$evidence" | tr '\n\r\t' '   ')"
  printf "%s\t%s\t%s\t%s\t%s\n" "$severity" "$check_id" "$title" "$details" "$evidence" >>"$FINDINGS_FILE"
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

config_bool() {
  local key="$1"
  local default_value="${2:-true}"
  node - "$SECURITY_REVIEW_CONFIG" "$key" "$default_value" <<'NODE'
const fs = require("node:fs");

const configPath = process.argv[2];
const keyPath = process.argv[3];
const defaultValue = String(process.argv[4] || "true").toLowerCase() === "true";

if (!configPath || !fs.existsSync(configPath)) {
  process.stdout.write(String(defaultValue));
  process.exit(0);
}

try {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const value = keyPath.split(".").reduce((acc, key) => (acc && Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined), config);
  if (typeof value === "boolean") {
    process.stdout.write(String(value));
  } else {
    process.stdout.write(String(defaultValue));
  }
} catch {
  process.stdout.write(String(defaultValue));
}
NODE
}

check_enabled() {
  local key="$1"
  local default_value="${2:-true}"
  local enabled
  enabled="$(config_bool "$key" "$default_value")"
  [ "$enabled" = "true" ]
}

file_perm() {
  local path="$1"
  if stat -f "%Lp" "$path" >/dev/null 2>&1; then
    stat -f "%Lp" "$path"
  else
    stat -c "%a" "$path"
  fi
}

perm_dec() {
  local p="${1#0}"
  echo "$((8#$p))"
}

check_max_permission() {
  local path="$1"
  local max_perm="$2"
  local severity="$3"
  local check_id="$4"
  local label="$5"

  [ -e "$path" ] || return 0

  local p current max
  p="$(file_perm "$path" 2>/dev/null || true)"
  [ -n "$p" ] || return 0
  current="$(perm_dec "$p")"
  max="$(perm_dec "$max_perm")"

  if [ "$current" -gt "$max" ]; then
    add_finding \
      "$severity" \
      "$check_id" \
      "Overly permissive file permissions" \
      "$label has permission $p, expected <= $max_perm." \
      "$path"
  fi
}

check_sensitive_permissions() {
  check_enabled "checks.sensitivePermissions" "true" || return 0

  check_max_permission "$WORKSPACE_ROOT/.env" "640" "high" "file_permissions_env" "Workspace .env"
  check_max_permission "$HOME/.openclaw/.env" "640" "high" "file_permissions_openclaw_env" "OpenClaw .env"
  check_max_permission "$HOME/.openclaw/openclaw.json" "640" "high" "file_permissions_openclaw_config" "OpenClaw config"
  check_max_permission "$WORKSPACE_ROOT/AGENTS.md" "644" "medium" "file_permissions_agents" "AGENTS.md"
  check_max_permission "$WORKSPACE_ROOT/SOUL.md" "644" "medium" "file_permissions_soul" "SOUL.md"
  check_max_permission "$WORKSPACE_ROOT/USER.md" "644" "medium" "file_permissions_user" "USER.md"

  while IFS= read -r db_file; do
    check_max_permission "$db_file" "640" "high" "file_permissions_db" "SQLite database"
  done < <(find "$WORKSPACE_ROOT" -type f \( -name "*.db" -o -name "*.sqlite" \) 2>/dev/null | head -n 100)
}

check_gateway_localhost_and_auth() {
  check_enabled "checks.gatewayLocalhostAndAuth" "true" || return 0

  local config="$HOME/.openclaw/openclaw.json"
  if [ ! -f "$config" ]; then
    add_finding "medium" "gateway_config_missing" "OpenClaw config not found" "Cannot validate gateway bind/auth without ~/.openclaw/openclaw.json." "$config"
    return 0
  fi

  local bind auth_enabled node_out
  node_out="$(node - "$config" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
try {
  const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
  const gw = cfg.gateway || {};
  const bind = gw.bind || gw.host || gw.address || "";
  const authEnabled = gw.auth?.enabled ?? cfg.auth?.enabled;
  process.stdout.write(String(bind) + "\n");
  process.stdout.write(String(authEnabled));
} catch {
  process.stdout.write("\n");
  process.stdout.write("unknown");
}
NODE
)"

  bind="$(printf '%s\n' "$node_out" | sed -n '1p')"
  auth_enabled="$(printf '%s\n' "$node_out" | sed -n '2p')"

  if [ -n "$bind" ]; then
    if [[ "$bind" =~ 0\.0\.0\.0|:: ]]; then
      add_finding "critical" "gateway_non_loopback" "Gateway may be exposed to network" "Gateway bind/host appears non-loopback: '$bind'." "$config"
    elif [[ "$bind" != *"127.0.0.1"* ]] && [[ "$bind" != *"localhost"* ]] && [[ "$bind" != "loopback" ]]; then
      add_finding "critical" "gateway_non_loopback" "Gateway may be exposed to network" "Gateway bind/host appears non-loopback: '$bind'." "$config"
    fi
  fi

  if [ "$auth_enabled" = "false" ]; then
    add_finding "critical" "gateway_auth_disabled" "Gateway auth appears disabled" "Gateway/API auth appears disabled in openclaw.json." "$config"
  fi
}

check_git_tracked_secrets() {
  check_enabled "checks.gitTrackedSecrets" "true" || return 0

  if ! has_command git || [ ! -d "$WORKSPACE_ROOT/.git" ]; then
    return 0
  fi

  local matches
  matches="$(
    git -C "$WORKSPACE_ROOT" ls-files -z 2>/dev/null \
      | xargs -0 rg -n --no-messages \
        -e 'sk_(live|test)_[A-Za-z0-9]{20,}' \
        -e 'sk-ant-[A-Za-z0-9\-]{20,}' \
        -e 'AKIA[0-9A-Z]{16}' \
        -e 'xox[a-z]-[A-Za-z0-9\-]{10,}' \
        -e 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' \
        | head -n 20 || true
  )"

  if [ -n "$matches" ]; then
    add_finding "critical" "secrets_in_git" "Potential secrets found in git-tracked files" "One or more secret patterns matched tracked files." "$matches"
  fi
}

check_security_modules_present() {
  check_enabled "checks.securityModulesPresent" "true" || return 0

  local missing=()
  local modules_root="$OPENCLAW_ROOT/councils/checks/security-checks"
  local required=(
    "$modules_root/content-sanitizer.js"
    "$modules_root/secret-redaction.js"
    "$modules_root/notification-redaction.js"
  )

  for path in "${required[@]}"; do
    [ -f "$path" ] || missing+=("$path")
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    add_finding "high" "security_modules_missing" "Security modules missing" "Required security modules were not found." "$(printf '%s;' "${missing[@]}")"
    return 0
  fi

  local usage_count
  usage_count="$( (rg -n "content-sanitizer|notification-redaction|secret-redaction" "$WORKSPACE_ROOT/scripts" "$WORKSPACE_ROOT/tools" 2>/dev/null || true) | wc -l | tr -d ' ' )"
  if [ "${usage_count:-0}" -eq 0 ]; then
    add_finding "medium" "security_modules_not_wired" "Security modules not integrated in scripts/tools" "Modules exist but no integration points were found in scripts/tools." ""
  fi
}

check_backup_encryption() {
  check_enabled "checks.backupEncryption" "true" || return 0

  local backup_script="$WORKSPACE_ROOT/scripts/backup-databases.sh"
  if [ ! -f "$backup_script" ]; then
    add_finding "medium" "backup_script_missing" "Backup script missing" "No backup-databases.sh found. Cannot verify backup encryption." "$backup_script"
    return 0
  fi

  if ! rg -q "gpg|openssl|age|rclone crypt|encrypted" "$backup_script"; then
    add_finding "high" "backup_encryption_not_detected" "Backup encryption not detected" "Backup script exists but no encryption markers (gpg/openssl/age) were detected." "$backup_script"
  fi
}

check_gitignore_rules() {
  check_enabled "checks.gitignoreRules" "true" || return 0

  local gitignore="$WORKSPACE_ROOT/.gitignore"
  if [ ! -f "$gitignore" ]; then
    add_finding "medium" "gitignore_missing" ".gitignore missing" "Security-related ignore rules cannot be enforced without .gitignore." "$gitignore"
    return 0
  fi

  local required_rules=(".env" ".env.*" "*.db" "*.sqlite" ".openclaw/" "councils/data/reports/")
  local missing=()
  local rule
  for rule in "${required_rules[@]}"; do
    rg -q "^${rule//\*/\\*}$" "$gitignore" || missing+=("$rule")
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    add_finding "medium" "gitignore_rules_missing" "Missing security ignore rules" "Some recommended ignore rules are missing from .gitignore." "$(printf '%s;' "${missing[@]}")"
  fi
}

check_prompt_injection_coverage() {
  check_enabled "checks.promptInjectionCoverage" "true" || return 0

  local sanitizer="$OPENCLAW_ROOT/councils/checks/security-checks/content-sanitizer.js"
  if [ ! -f "$sanitizer" ]; then
    add_finding "high" "prompt_injection_sanitizer_missing" "Prompt-injection sanitizer missing" "No content-sanitizer.js found." "$sanitizer"
    return 0
  fi

  if ! rg -q "ignore (all|any|previous|prior) instructions|(system|developer).*prompt" "$sanitizer"; then
    add_finding "medium" "prompt_injection_patterns_weak" "Prompt-injection coverage appears weak" "content-sanitizer.js does not contain expected prompt-injection patterns." "$sanitizer"
  fi
}

check_auth_failures_in_logs() {
  check_enabled "checks.authFailuresInLogs" "true" || return 0

  local log_file="$HOME/.openclaw/logs/gateway.err.log"
  [ -f "$log_file" ] || return 0

  local count
  count="$( (tail -n 5000 "$log_file" | rg -i "auth|unauthorized|forbidden|invalid token|token mismatch" || true) | wc -l | tr -d ' ' )"
  count="${count:-0}"

  if [ "$count" -ge 20 ]; then
    add_finding "high" "auth_failures_in_logs" "Repeated auth failures in gateway logs" "Detected $count auth-related error lines in last 5000 gateway error log entries." "$log_file"
  elif [ "$count" -gt 0 ]; then
    add_finding "medium" "auth_failures_in_logs" "Auth failures observed in gateway logs" "Detected $count auth-related error lines in last 5000 gateway error log entries." "$log_file"
  fi
}

check_no_env_commit() {
  check_enabled "checks.noEnvCommit" "true" || return 0

  local script="$OPENCLAW_ROOT/councils/checks/security-checks/no-env-commit.js"
  [ -f "$script" ] || return 0

  local out
  out="$(node "$script" --workspace-root "$WORKSPACE_ROOT" 2>/dev/null || true)"
  [ -n "$out" ] || return 0

  while IFS=$'\t' read -r severity id title details evidence; do
    [ -n "${id:-}" ] || continue
    add_finding "$severity" "$id" "$title" "$details" "$evidence"
  done < <(
    node - "$out" <<'NODE'
const input = process.argv[2] || "{}";
let parsed = {};
try { parsed = JSON.parse(input); } catch {}
for (const f of parsed.findings || []) {
  const sev = String(f.severity || "medium");
  const id = String(f.id || "no_env_commit");
  const title = String(f.title || "Tracked .env file detected");
  const details = String(f.details || "");
  const evidence = String(f.evidence || "");
  process.stdout.write(`${sev}\t${id}\t${title}\t${details}\t${evidence}\n`);
}
NODE
  )
}

check_safe_delete_policy() {
  check_enabled "checks.safeDeletePolicy" "true" || return 0

  local script="$OPENCLAW_ROOT/councils/checks/security-checks/safe-delete.js"
  [ -f "$script" ] || return 0

  local out
  out="$(node "$script" --workspace-root "$WORKSPACE_ROOT" 2>/dev/null || true)"
  [ -n "$out" ] || return 0

  while IFS=$'\t' read -r severity id title details evidence; do
    [ -n "${id:-}" ] || continue
    add_finding "$severity" "$id" "$title" "$details" "$evidence"
  done < <(
    node - "$out" <<'NODE'
const input = process.argv[2] || "{}";
let parsed = {};
try { parsed = JSON.parse(input); } catch {}
for (const f of parsed.findings || []) {
  const sev = String(f.severity || "medium");
  const id = String(f.id || "safe_delete_policy");
  const title = String(f.title || "Unsafe delete path detected");
  const details = String(f.details || "");
  const evidence = String(f.evidence || "");
  process.stdout.write(`${sev}\t${id}\t${title}\t${details}\t${evidence}\n`);
}
NODE
  )
}

run_all_security_checks() {
  check_sensitive_permissions
  check_gateway_localhost_and_auth
  check_git_tracked_secrets
  check_no_env_commit
  check_safe_delete_policy
  check_security_modules_present
  check_backup_encryption
  check_gitignore_rules
  check_prompt_injection_coverage
  check_auth_failures_in_logs
}
