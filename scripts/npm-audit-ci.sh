#!/usr/bin/env sh
# Dependency audit gate that fails on findings, not on npmjs.com weather.
#
# `npm audit` exits 1 both when it finds vulnerabilities and when the registry
# audit endpoint is unreachable, so a registry 503 fails CI for no real reason.
# The two cases are distinguishable in `--json` output:
#
#   real report      → { "metadata": { "vulnerabilities": { "high": N, ... } } }
#   transport error  → { "message": "request to … failed, reason: …", "error": {} }
#
# So: parse the report and fail on high/critical findings; retry a transport
# error a few times, then warn and pass. GitHub Dependabot alerts remain the
# durable backstop for advisories published while the endpoint was down.
#
# Each attempt is bounded (npm's own retry/backoff can run for minutes before
# giving up), so the worst case here is ~3 minutes rather than an open-ended hang.
#
# Usage:
#   sh scripts/npm-audit-ci.sh        # from the package directory
#   npm run audit:ci
#
# Env:
#   AUDIT_LEVEL     lowest severity that fails the gate (default: high)
#   AUDIT_ATTEMPTS  transport-error retries (default: 2)
#   AUDIT_ALLOWLIST waiver file (default: scripts/npm-audit-allowlist.json)
#
# Waivers: an advisory with no patched release on a dev-only chain may be
# listed in npm-audit-allowlist.json with the workspaces (package directory
# basenames, e.g. the repo folder name for a single-package repo) it applies to, a
# reason, and a `review_by` date (YYYY-MM-DD). A waived advisory also clears
# the parents that are vulnerable only through it. Waivers are printed on
# every run, stop applying after `review_by`, and a malformed file waives
# nothing. Policy: docs/agent-rules/README.md (dependency audit).
set -eu

AUDIT_LEVEL="${AUDIT_LEVEL:-high}"
AUDIT_ALLOWLIST="${AUDIT_ALLOWLIST:-$(dirname "$0")/npm-audit-allowlist.json}"
# Each attempt lets npm retry the request once internally, so 2 attempts is
# 4 HTTP tries. Bounded worst case: 2 x 90s plus 10s backoff, ~3 minutes.
AUDIT_ATTEMPTS="${AUDIT_ATTEMPTS:-2}"
ATTEMPT_TIMEOUT_SECONDS=90
FETCH_TIMEOUT_MS=30000

# Exit codes from the parser below.
PARSE_CLEAN=0
PARSE_VULNERABLE=10
PARSE_UNAVAILABLE=20

# GNU coreutils `timeout` exists on the CI runners but not on stock macOS.
# Bound the attempt where we can; run bare where we cannot.
run_audit() {
  out_file=$1
  # npm exits non-zero for findings AND for endpoint errors; the JSON shape is
  # the only reliable signal, so the exit code is deliberately discarded (the
  # `|| true` also keeps `set -e` from killing the retry loop).
  if command -v timeout >/dev/null 2>&1; then
    timeout "$ATTEMPT_TIMEOUT_SECONDS" npm audit --json \
      --fetch-retries=1 --fetch-timeout="$FETCH_TIMEOUT_MS" >"$out_file" 2>/dev/null || true
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$ATTEMPT_TIMEOUT_SECONDS" npm audit --json \
      --fetch-retries=1 --fetch-timeout="$FETCH_TIMEOUT_MS" >"$out_file" 2>/dev/null || true
  else
    npm audit --json --fetch-retries=1 --fetch-timeout="$FETCH_TIMEOUT_MS" >"$out_file" 2>/dev/null || true
  fi
}

# Reads the report and decides. Prints the offending advisories when it fails.
classify_report() {
  AUDIT_LEVEL="$AUDIT_LEVEL" AUDIT_ALLOWLIST="$AUDIT_ALLOWLIST" node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const CLEAN = 0, VULNERABLE = 10, UNAVAILABLE = 20;
    const ORDER = ["info", "low", "moderate", "high", "critical"];
    const workspace = path.basename(process.cwd());
    const today = new Date().toISOString().slice(0, 10);

    // Active waivers for this workspace, keyed by advisory id. Fail closed.
    const waivers = new Map();
    if (fs.existsSync(process.env.AUDIT_ALLOWLIST)) {
      let entries = [];
      try {
        entries = JSON.parse(fs.readFileSync(process.env.AUDIT_ALLOWLIST, "utf8"));
        if (!Array.isArray(entries)) throw new Error("expected a JSON array");
      } catch (error) {
        console.error(`   ⚠️  ignoring malformed audit allowlist: ${error.message}`);
        entries = [];
      }
      for (const entry of entries) {
        const valid =
          entry && typeof entry.advisory === "string" && typeof entry.package === "string" &&
          Array.isArray(entry.workspaces) && typeof entry.reason === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(entry.review_by || "");
        if (!valid) {
          console.error(`   ⚠️  ignoring invalid audit allowlist entry: ${JSON.stringify(entry)}`);
          continue;
        }
        if (!entry.workspaces.includes(workspace)) continue;
        if (entry.review_by < today) {
          console.error(`   ⚠️  waiver for ${entry.advisory} (${entry.package}) expired on ${entry.review_by}; re-check it`);
          continue;
        }
        waivers.set(entry.advisory, entry);
      }
    }

    let report;
    try {
      report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    } catch {
      process.exit(UNAVAILABLE);
    }

    const counts = report && report.metadata && report.metadata.vulnerabilities;
    if (!counts) {
      const reason = (report && report.message) || "no audit report in response";
      console.error(`   registry did not return a report: ${reason}`);
      process.exit(UNAVAILABLE);
    }

    const threshold = ORDER.indexOf(process.env.AUDIT_LEVEL);
    const blocking = ORDER.slice(threshold < 0 ? ORDER.indexOf("high") : threshold);
    const vulnerabilities = report.vulnerabilities || {};

    // A package is waived when every advisory it carries directly is waived
    // for this package and every dependency it is vulnerable through is
    // itself waived. Cycles and unknown names count as not waived.
    const memo = new Map();
    const advisoryId = via => String(via.url || "").split("/").pop();
    const isWaived = name => {
      if (memo.has(name)) return memo.get(name);
      memo.set(name, false);
      const entry = vulnerabilities[name];
      const result =
        Boolean(entry) &&
        (entry.via || []).every(via =>
          typeof via === "string"
            ? isWaived(via)
            : waivers.get(advisoryId(via))?.package === via.dependency
        );
      memo.set(name, result);
      return result;
    };

    const unwaived = Object.entries(vulnerabilities).filter(([name]) => !isWaived(name));
    const total = unwaived.filter(([, entry]) => blocking.includes(entry.severity)).length;

    for (const [name, entry] of Object.entries(vulnerabilities)) {
      if (!isWaived(name)) continue;
      for (const via of entry.via || []) {
        if (typeof via === "string") continue;
        const waiver = waivers.get(advisoryId(via));
        console.log(`   ℹ️  waived: ${waiver.advisory} (${name}, ${via.severity}), review_by ${waiver.review_by}`);
      }
    }

    if (total === 0) {
      console.log(`   ${unwaived.length} unwaived advisory/advisories below the ${process.env.AUDIT_LEVEL} threshold`);
      process.exit(CLEAN);
    }

    console.error(`   ${total} ${process.env.AUDIT_LEVEL}+ advisory/advisories:`);
    for (const [name, entry] of unwaived) {
      if (!blocking.includes(entry.severity)) continue;
      const via = (entry.via || [])
        .map(v => (typeof v === "string" ? v : v.title))
        .filter(Boolean)
        .join("; ");
      console.error(`   - ${name} (${entry.severity})${via ? `: ${via}` : ""}`);
    }
    process.exit(VULNERABLE);
  ' "$1"
}

echo "🔍 Running npm audit (fails at ${AUDIT_LEVEL} and above)..."

report_file=$(mktemp)
# shellcheck disable=SC2064
trap "rm -f '$report_file'" EXIT

attempt=1
while [ "$attempt" -le "$AUDIT_ATTEMPTS" ]; do
  run_audit "$report_file"

  set +e
  classify_report "$report_file"
  verdict=$?
  set -e

  case "$verdict" in
    "$PARSE_CLEAN")
      echo "✅ No ${AUDIT_LEVEL}+ vulnerabilities"
      exit 0
      ;;
    "$PARSE_VULNERABLE")
      echo ""
      echo "Fix with \`npm audit fix\`, a direct dependency bump, or a documented"
      echo "\`overrides\` entry. If no patched release exists and the chain is"
      echo "dev-only, add a dated waiver to scripts/npm-audit-allowlist.json"
      echo "(fields: advisory, package, workspaces, reason, review_by)."
      exit 1
      ;;
    *)
      if [ "$attempt" -lt "$AUDIT_ATTEMPTS" ]; then
        backoff=$((attempt * 10))
        echo "   attempt ${attempt}/${AUDIT_ATTEMPTS} failed; retrying in ${backoff}s..."
        sleep "$backoff"
      fi
      ;;
  esac

  attempt=$((attempt + 1))
done

echo "::warning title=npm audit unavailable::The npm registry audit endpoint did not respond after ${AUDIT_ATTEMPTS} attempts. Dependencies were NOT audited in this run; Dependabot alerts still apply."
echo "⚠️  npm audit skipped — registry unavailable after ${AUDIT_ATTEMPTS} attempts."
exit 0
