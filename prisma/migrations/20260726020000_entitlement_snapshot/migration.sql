-- Grandfathering: record what a plan included when the school signed up, so
-- later edits to the plan catalog don't silently change existing schools.

ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "entitlement_snapshot" JSONB;

-- Backfill every existing school with the catalog as it stands today, so the
-- terms they have right now are what they keep.
UPDATE "schools" SET "entitlement_snapshot" = jsonb_build_object(
  'plan', "subscription_plan",
  'taken_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'features', CASE "subscription_plan"
    WHEN 'basic'      THEN '["access_logs","people","attendance","passes"]'::jsonb
    WHEN 'premium'    THEN '["access_logs","people","attendance","passes","bus","messaging","reports"]'::jsonb
    WHEN 'enterprise' THEN '["access_logs","people","attendance","passes","bus","messaging","reports","crm","custom_roles","multi_campus"]'::jsonb
    ELSE '["access_logs","people"]'::jsonb
  END,
  'limits', CASE "subscription_plan"
    WHEN 'basic'      THEN '{"people":500,"gates":2}'::jsonb
    WHEN 'premium'    THEN '{"people":2000,"gates":null}'::jsonb
    WHEN 'enterprise' THEN '{"people":null,"gates":null}'::jsonb
    ELSE '{"people":100,"gates":1}'::jsonb
  END
)
WHERE "entitlement_snapshot" IS NULL;
