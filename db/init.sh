#!/bin/bash
# Wait for PostgreSQL to be ready, then run migrations
set -e

echo "Waiting for PostgreSQL to be ready..."
until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" 2>/dev/null; do
    sleep 1
done

echo "PostgreSQL is ready. Running migrations..."

for migration in /docker-entrypoint-initdb.d/migrations/*.sql; do
    echo "Applying: $migration"
    PGPASSWORD="$POSTGRES_PASSWORD" psql \
        -h "$POSTGRES_HOST" \
        -p "$POSTGRES_PORT" \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        -f "$migration"
done

echo "All migrations applied."
