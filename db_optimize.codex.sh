#!/usr/bin/env bash
set -euo pipefail

# --- Config ---
: "${PGURL:?PGURL is required (postgres://...)}"
SCHEMA="${SCHEMA:-public}"
TARGET_TABLE="${TARGET_TABLE:-}"
PARTITION_COLUMN="${PARTITION_COLUMN:-}"
PARTITION_INTERVAL="${PARTITION_INTERVAL:-month}"   # day|month|year
SHARD_KEY="${SHARD_KEY:-}"
MV_NAME="${MV_NAME:-}"
MV_SQL="${MV_SQL:-}"
TEST_SQL="${TEST_SQL:-}"
DRY_RUN="${DRY_RUN:-1}"

psqlx(){ psql "$PGURL" -v ON_ERROR_STOP=1 -X -q "$@"; }
run(){ if [[ "$DRY_RUN" == "1" ]]; then echo "DRYRUN> $*"; else eval "$*"; fi }

if command -v psql >/dev/null 2>&1; then
  HAVE_PSQL=1
else
  HAVE_PSQL=0
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "!! Warning: 'psql' command not found; SQL statements will be emitted but not executed." >&2
    psqlx(){
      echo "(psql missing) psql \"$PGURL\" -v ON_ERROR_STOP=1 -X -q $*" >&2
      return 0
    }
  else
    echo "Error: required command 'psql' not found in PATH." >&2
    exit 1
  fi
fi

echo "== CODEx: Database Optimization Suite (PostgreSQL) =="
echo " DRY_RUN=$DRY_RUN  SCHEMA=$SCHEMA  TABLE=$TARGET_TABLE"

# 0) Baseline telemetry
echo "-> Enabling extensions where possible (pg_stat_statements, pg_prewarm, auto_explain)..."
run "psqlx -c \"CREATE EXTENSION IF NOT EXISTS pg_stat_statements;\""
run "psqlx -c \"CREATE EXTENSION IF NOT EXISTS pg_prewarm;\""
run "psqlx -c \"LOAD 'auto_explain';\" || true"
run "psqlx -c \"SELECT now() AS ts, version();\""

# 1) INDEXING — suggest/create btree indexes for FKs + common predicates
if [[ -n "$TARGET_TABLE" ]]; then
  echo "-> Index audit for $SCHEMA.$TARGET_TABLE"
  IDX_SQL=$(cat <<EOS
WITH cols AS (
  SELECT a.attname AS col
  FROM pg_attribute a
  JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='$SCHEMA' AND c.relname='$TARGET_TABLE' AND a.attnum>0 AND NOT a.attisdropped
),
fks AS (
  SELECT a.attname AS col FROM pg_constraint co
  JOIN pg_class c ON c.oid=co.conrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN unnest(co.conkey) WITH ORDINALITY k(attnum,ord) ON true
  JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
  WHERE co.contype='f' AND n.nspname='$SCHEMA' AND c.relname='$TARGET_TABLE'
),
need AS (
  SELECT DISTINCT col FROM (
    SELECT col FROM fks
    UNION ALL
    SELECT col FROM cols WHERE col IN ('id','created_at','updated_at','${SHARD_KEY}')
  ) u
  EXCEPT
  SELECT a.attname
  FROM pg_index i
  JOIN pg_class c ON c.oid=i.indrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN unnest(i.indkey) WITH ORDINALITY k(attnum,ord) ON true
  JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
  WHERE n.nspname='$SCHEMA' AND c.relname='$TARGET_TABLE' AND i.indisvalid
)
SELECT format('CREATE INDEX IF NOT EXISTS %I ON %I.%I(%I);',
              $TARGET_TABLE||'__'||col||'__bt', $SCHEMA, $TARGET_TABLE, col) AS ddl
FROM need;
EOS
)
  if [[ "$HAVE_PSQL" -eq 1 ]]; then
    DDLs=$(psqlx -t -A -c "$IDX_SQL" || true)
    if [[ -n "$DDLs" ]]; then
      echo "$DDLs" | while read -r ddl; do run "psqlx -c \"$ddl\""; done
    else
      echo "   (no missing simple indexes detected)"
    fi
  else
    echo "   (psql not available to inspect existing indexes)"
  fi
fi

# 2) MATERIALIZED VIEWS — precompute heavy reads
if [[ -n "$MV_NAME" && -n "$MV_SQL" ]]; then
  echo "-> Ensuring materialized view $MV_NAME"
  run "psqlx -c \"CREATE MATERIALIZED VIEW IF NOT EXISTS $SCHEMA.$MV_NAME AS $MV_SQL WITH NO DATA;\""
  run "psqlx -c \"CREATE UNIQUE INDEX IF NOT EXISTS ${MV_NAME}_idx ON $SCHEMA.$MV_NAME(1);\" || true"
  run "psqlx -c \"REFRESH MATERIALIZED VIEW CONCURRENTLY $SCHEMA.$MV_NAME;\" || psqlx -c \"REFRESH MATERIALIZED VIEW $SCHEMA.$MV_NAME;\""
fi

# 3) VERTICAL SCALING — print right-size hints (no config writes by default)
echo "-> Vertical scaling hints:"
if [[ "$HAVE_PSQL" -eq 1 ]]; then
  psqlx -c "SELECT name, setting FROM pg_settings WHERE name IN ('shared_buffers','work_mem','maintenance_work_mem','effective_cache_size');"
else
  echo "   (psql not available to read pg_settings)"
fi

# 4) DENORMALIZATION — optional rollup table (safe template)
if [[ -n "$TARGET_TABLE" ]]; then
  echo "-> (Optional) Denormalized summary template emitted as SQL (not executed):"
  cat <<EOS
-- Example summary (copy/paste to apply)
CREATE TABLE IF NOT EXISTS $SCHEMA.${TARGET_TABLE}_daily_summary AS
SELECT date_trunc('day', $PARTITION_COLUMN::timestamp) AS d, count(*) AS n
FROM $SCHEMA.$TARGET_TABLE GROUP BY 1;
CREATE INDEX IF NOT EXISTS ${TARGET_TABLE}_daily_summary_d_idx ON $SCHEMA.${TARGET_TABLE}_daily_summary(d);
EOS
fi

# 5) DATABASE CACHING — prewarm hot indexes
if [[ -n "$TARGET_TABLE" ]]; then
  echo "-> Prewarm hot btree indexes (pg_prewarm)"
  run "psqlx -c \"SELECT relname, pg_prewarm(indexrelid) FROM pg_stat_user_indexes WHERE schemaname='$SCHEMA' AND relname LIKE '$TARGET_TABLE%';\""
fi

# 6) REPLICATION — emit reference commands
echo "-> Replication quickstart (reference only, not executed):"
cat <<EOS
-- Primary:
SELECT pg_create_physical_replication_slot('replica_slot') WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name='replica_slot');
-- Replica host shell:
pg_basebackup -h PRIMARY_HOST -D /var/lib/postgresql/data -U repl -X stream -C -S replica_slot -R
EOS

# 7) SHARDING — if Citus available, distribute table by SHARD_KEY
if [[ -n "$SHARD_KEY" && -n "$TARGET_TABLE" ]]; then
  echo "-> Attempt Citus distribution on $SCHEMA.$TARGET_TABLE USING $SHARD_KEY"
  run "psqlx -c \"CREATE EXTENSION IF NOT EXISTS citus; SELECT create_distributed_table('$SCHEMA.$TARGET_TABLE','$SHARD_KEY');\" || true"
fi

# 8) PARTITIONING — create range partitions forward
if [[ -n "$TARGET_TABLE" && -n "$PARTITION_COLUMN" ]]; then
  echo "-> Ensure range partitioning on $SCHEMA.$TARGET_TABLE by $PARTITION_COLUMN ($PARTITION_INTERVAL)"
  run "psqlx -c \"ALTER TABLE IF NOT EXISTS $SCHEMA.$TARGET_TABLE PARTITION BY RANGE ($PARTITION_COLUMN);\" || true"
  # Create current + next 2 partitions
  for off in 0 1 2; do
    case "$PARTITION_INTERVAL" in
      day)   from="$(date -u -d "$off day" +%Y-%m-%d)";   to="$(date -u -d "$off day +1 day" +%Y-%m-%d)";   suffix="$(date -u -d "$off day" +%Y%m%d)";;
      month) from="$(date -u -d "+$off month" +%Y-%m-01)"; to="$(date -u -d "+$((off+1)) month" +%Y-%m-01)"; suffix="$(date -u -d "+$off month" +%Y%m)";;
      year)  from="$(date -u -d "+$off year" +%Y-01-01)";  to="$(date -u -d "+$((off+1)) year" +%Y-01-01)";  suffix="$(date -u -d "+$off year" +%Y)";;
      *) echo "Unknown PARTITION_INTERVAL"; exit 1;;
    esac
    run "psqlx -c \"CREATE TABLE IF NOT EXISTS $SCHEMA.${TARGET_TABLE}_p${suffix} PARTITION OF $SCHEMA.$TARGET_TABLE FOR VALUES FROM ('${from}') TO ('${to}');\""
  done
fi

# 9) QUERY OPTIMIZATION — stats refresh + plan capture
echo "-> VACUUM (ANALYZE) and top query report..."
if [[ -n "$TARGET_TABLE" ]]; then run "psqlx -c \"VACUUM (ANALYZE) $SCHEMA.$TARGET_TABLE;\""; fi
run "psqlx -c \"SELECT query, calls, total_time, mean_time FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;\""
if [[ -n "$TEST_SQL" ]]; then
  echo "-> EXPLAIN (ANALYZE, BUFFERS) for TEST_SQL"
  run "psqlx -c \"EXPLAIN (ANALYZE, BUFFERS) $TEST_SQL;\""
fi

echo "== Done. Set DRY_RUN=0 to apply changes. Optimize early, measure often. =="

