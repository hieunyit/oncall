#!/bin/sh
set -e

# On fresh DB: migrate deploy applies 0_init which creates all tables.
# On existing DB: 0_init is baselined (tables already exist), migrate deploy is a no-op.

cat > /tmp/check_db.js << 'JSEOF'
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.$queryRawUnsafe("SELECT to_regclass('public.users') AS t")
  .then(r => { console.log(r[0].t ? '1' : '0'); })
  .catch(() => console.log('0'))
  .finally(() => p.$disconnect());
JSEOF

USERS_EXISTS=$(node /tmp/check_db.js 2>/dev/null || echo '0')

if [ "$USERS_EXISTS" = "1" ]; then
  echo "[migrate] Existing database — marking 0_init as baseline..."
  npx prisma migrate resolve --applied 0_init 2>/dev/null || true
else
  echo "[migrate] Fresh database — running clean migration..."
  # Remove any stale 0_init record from a previous failed run
  cat > /tmp/clean_db.js << 'JSEOF2'
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.$executeRawUnsafe("DELETE FROM _prisma_migrations WHERE migration_name = '0_init'")
  .catch(() => {})
  .finally(() => p.$disconnect());
JSEOF2
  node /tmp/clean_db.js 2>/dev/null || true
fi

exec npx prisma migrate deploy
