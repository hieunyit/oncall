#!/bin/sh
set -e

# Write check script to temp file to avoid shell escaping issues
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
  echo "[migrate] Existing database detected — applying baseline..."
  npx prisma migrate resolve --applied 0_init 2>/dev/null || true
  npx prisma migrate resolve --rolled-back 7_cascade_delete_fix 2>/dev/null || true
  npx prisma migrate resolve --rolled-back 9_override_shift_cascade 2>/dev/null || true
  npx prisma migrate resolve --rolled-back 10_escalation_policy_cascade 2>/dev/null || true
  npx prisma migrate resolve --rolled-back 11_cleanup_orphaned_shifts 2>/dev/null || true
else
  echo "[migrate] Fresh database detected — cleaning up any stale migration records..."
  # Remove wrongly-applied 0_init record left by a previous failed run
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
