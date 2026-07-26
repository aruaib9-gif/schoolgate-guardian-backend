-- Customizable billing: per-school overrides + platform-wide defaults.
-- Modes: flat | per_student | per_person.  Cycles: monthly | termly (3 months) | annual.

-- Per-school overrides (NULL = inherit the platform default).
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "billing_mode"  TEXT;
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "billing_cycle" TEXT;
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "unit_price"    DOUBLE PRECISION;
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "custom_price"  DOUBLE PRECISION;

-- Platform-wide billing defaults.
ALTER TABLE "platform_config" ADD COLUMN IF NOT EXISTS "billing_mode"    TEXT             NOT NULL DEFAULT 'flat';
ALTER TABLE "platform_config" ADD COLUMN IF NOT EXISTS "billing_cycle"   TEXT             NOT NULL DEFAULT 'monthly';
ALTER TABLE "platform_config" ADD COLUMN IF NOT EXISTS "termly_discount" DOUBLE PRECISION NOT NULL DEFAULT 5;
ALTER TABLE "platform_config" ADD COLUMN IF NOT EXISTS "annual_discount" DOUBLE PRECISION NOT NULL DEFAULT 15;
ALTER TABLE "platform_config" ADD COLUMN IF NOT EXISTS "currency"        TEXT             NOT NULL DEFAULT 'NGN';
