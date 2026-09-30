#!/usr/bin/env bash
# Where do Firestore reads come from? Turns on Firestore Data Access audit logs, makes them
# queryable with SQL (Log Analytics on the _Default log bucket, linked to BigQuery as the
# dataset flack_logs), and reports reads by person, operation and collection.
#
#   scripts/read-audit.sh on               # start logging (from now on; not retroactive)
#   scripts/read-audit.sh report [hours]   # reads in the last N hours (default 24)
#   scripts/read-audit.sh off              # stop logging (the linked dataset stays)
#
# Cost: one log entry per read/write request (not per document). A small team stays well
# inside Cloud Logging's 50 GiB/month free ingestion; queries use BigQuery's free tier.
# Entries are kept 30 days, like the rest of _Default.
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
[[ -n "$FLACK_PROJECT" ]] || die "No project configured (run npm run setup first)."
G="$ROOT/scripts/gcloud.sh"
DATASET=flack_logs

token() { "$G" auth print-access-token; }
api() { # api METHOD URL [JSON]
  curl -sS -X "$1" "$2" -H "Authorization: Bearer $(token)" -H "x-goog-user-project: $FLACK_PROJECT" \
    -H 'Content-Type: application/json' ${3:+-d "$3"}
}

# Adds or removes the Firestore DATA_READ/DATA_WRITE audit config in the project IAM policy.
set_audit() {
  local policy tmp
  policy=$(api POST "https://cloudresourcemanager.googleapis.com/v1/projects/$FLACK_PROJECT:getIamPolicy" '{"options":{"requestedPolicyVersion":3}}')
  tmp=$(mktemp)
  MODE="$1" node -e '
    const p = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (p.error) { console.error(p.error.message); process.exit(1); }
    const svc = "datastore.googleapis.com"; // Firestore audit settings live under the Datastore service name
    p.auditConfigs = (p.auditConfigs || []).filter((c) => c.service !== svc);
    if (process.env.MODE === "on") p.auditConfigs.push({ service: svc, auditLogConfigs: [{ logType: "DATA_READ" }, { logType: "DATA_WRITE" }] });
    process.stdout.write(JSON.stringify({ policy: p, updateMask: "auditConfigs,bindings,etag" }));
  ' <<<"$policy" >"$tmp"
  local out
  out=$(api POST "https://cloudresourcemanager.googleapis.com/v1/projects/$FLACK_PROJECT:setIamPolicy" "$(cat "$tmp")")
  rm -f "$tmp"
  if grep -q '"error"' <<<"$out"; then
    echo "$out" >&2
    die "Couldn't update the audit log settings."
  fi
}

case "${1:-report}" in
  on)
    "$G" services enable logging.googleapis.com bigquery.googleapis.com --quiet >/dev/null
    set_audit on
    echo "✓ Firestore Data Access audit logs on"
    if [[ "$("$G" logging buckets describe _Default --location=global --format='value(analyticsEnabled)')" != True ]]; then
      "$G" logging buckets update _Default --location=global --enable-analytics --quiet >/dev/null
    fi
    echo "✓ Log Analytics on for the _Default bucket"
    if ! "$G" logging links describe "$DATASET" --bucket=_Default --location=global >/dev/null 2>&1; then
      "$G" logging links create "$DATASET" --bucket=_Default --location=global --quiet >/dev/null
    fi
    echo "✓ Linked to BigQuery as $FLACK_PROJECT.$DATASET (table _AllLogs)"
    echo "Reads are logged from now on. Try: scripts/read-audit.sh report"
    ;;
  off)
    set_audit off
    echo "✓ Firestore Data Access audit logs off (existing entries expire after 30 days)"
    ;;
  report)
    hours="${2:-24}"
    [[ "$hours" =~ ^[0-9]{1,4}$ ]] || die "Hours must be a number."
    sql="
      WITH r AS (
        SELECT
          COALESCE(JSON_VALUE(proto_payload.audit_log.authentication_info.third_party_principal.payload.user_id),
                   proto_payload.audit_log.authentication_info.principal_email, 'unknown') AS who,
          REGEXP_EXTRACT(proto_payload.audit_log.method_name, r'Firestore\\.(\\w+)\$') AS op,
          COALESCE(
            REGEXP_EXTRACT(TO_JSON_STRING(proto_payload.audit_log.request), r'\"collectionId\":\"([^\"]+)\"'),
            REGEXP_EXTRACT(proto_payload.audit_log.resource_name, r'/documents/(?:[^/]+/[^/]+/)*([^/]+)/[^/]+\$'),
            REGEXP_EXTRACT(proto_payload.audit_log.resource_name, r'/documents/(.*)\$'),
            '(stream)') AS collection,
          COALESCE(proto_payload.audit_log.num_response_items, 0) AS docs
        FROM \`$FLACK_PROJECT.$DATASET._AllLogs\`
        WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL $hours HOUR)
          AND proto_payload.audit_log.service_name = 'firestore.googleapis.com'
          AND proto_payload.audit_log.authorization_info[SAFE_OFFSET(0)].permission_type = 'DATA_READ'
      )
      SELECT who, op, collection, SUM(docs) AS reads, COUNT(*) AS requests
      FROM r GROUP BY who, op, collection ORDER BY reads DESC LIMIT 40"
    body=$(node -e 'process.stdout.write(JSON.stringify({ query: process.argv[1], useLegacySql: false, timeoutMs: 60000 }))' "$sql")
    api POST "https://bigquery.googleapis.com/bigquery/v2/projects/$FLACK_PROJECT/queries" "$body" | node -e '
      const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
      if (r.error) { console.error(r.error.message); process.exit(1); }
      const rows = (r.rows || []).map((x) => x.f.map((c) => c.v));
      if (!rows.length) { console.log("No reads logged in this window yet (logging starts when you turn it on)."); process.exit(0); }
      const total = rows.reduce((s, x) => s + Number(x[3]), 0);
      console.log(`Top Firestore reads (${total} documents in these rows):\n`);
      console.log("reads".padStart(8), "reqs".padStart(6), " op".padEnd(20), "collection".padEnd(22), "who");
      for (const [who, op, col, reads, reqs] of rows) console.log(String(reads).padStart(8), String(reqs).padStart(6), " " + String(op).padEnd(19), String(col).padEnd(22), who);
    '
    ;;
  *) die "Usage: scripts/read-audit.sh on|off|report [hours]" ;;
esac
