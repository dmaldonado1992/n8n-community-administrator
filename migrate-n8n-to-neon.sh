#!/bin/sh
set -eu

: "${SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL is required}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"

MIRROR_DB="${MIRROR_DATABASE_NAME:-n8n_mirror}"
TARGET_BASE="${TARGET_DATABASE_URL%%\?*}"
TARGET_PREFIX="${TARGET_BASE%/*}"
TARGET_MIRROR_URL="${TARGET_PREFIX}/${MIRROR_DB}"
case "$TARGET_DATABASE_URL" in
  *\?*) TARGET_MIRROR_URL="${TARGET_MIRROR_URL}?${TARGET_DATABASE_URL#*\?}" ;;
esac

echo "Checking target database..."
if ! psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_database WHERE datname = '$MIRROR_DB'" | grep -q 1; then
  psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$MIRROR_DB\""
fi

echo "Creating consistent dump from Render PostgreSQL..."
pg_dump --dbname="$SOURCE_DATABASE_URL" --format=custom --no-owner --no-acl --file=/tmp/n8n.dump

echo "Resetting target public schema..."
psql "$TARGET_MIRROR_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "Restoring full n8n database into Neon..."
pg_restore --dbname="$TARGET_MIRROR_URL" --no-owner --no-acl --exit-on-error /tmp/n8n.dump

echo "Validating restored database..."
SOURCE_TABLES="$(psql "$SOURCE_DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
TARGET_TABLES="$(psql "$TARGET_MIRROR_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
SOURCE_WORKFLOWS="$(psql "$SOURCE_DATABASE_URL" -tAc 'SELECT count(*) FROM workflow_entity')"
TARGET_WORKFLOWS="$(psql "$TARGET_MIRROR_URL" -tAc 'SELECT count(*) FROM workflow_entity')"

echo "VALIDATION source_tables=$SOURCE_TABLES target_tables=$TARGET_TABLES source_workflows=$SOURCE_WORKFLOWS target_workflows=$TARGET_WORKFLOWS"
test "$SOURCE_TABLES" = "$TARGET_TABLES"
test "$SOURCE_WORKFLOWS" = "$TARGET_WORKFLOWS"
echo "MIGRATION_COMPLETED_OK"
