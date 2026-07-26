-- Plan entitlements + subscription lifecycle.
-- feature_overrides / limit_overrides let a single school be granted or denied
-- a capability without inventing a new plan.

ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "trial_ends_at"     TIMESTAMP(3);
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "suspended_at"      TIMESTAMP(3);
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "feature_overrides" JSONB;
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "limit_overrides"   JSONB;

-- Backfill: give existing trial schools a deadline instead of locking them out
-- immediately on deploy (grace = 14 days from now).
UPDATE "schools"
   SET "trial_ends_at" = NOW() + INTERVAL '14 days'
 WHERE "status" = 'trial' AND "trial_ends_at" IS NULL;

-- Suspended schools start their read-only grace window from now, not from an
-- unknown past date, so nobody is hard-locked the moment this ships.
UPDATE "schools"
   SET "suspended_at" = NOW()
 WHERE "status" IN ('suspended','inactive') AND "suspended_at" IS NULL;
