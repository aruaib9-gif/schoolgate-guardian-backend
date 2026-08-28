-- The billing package catalog, previously a hardcoded constant in lib/plans.js.
CREATE TABLE "plans" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "color"        TEXT NOT NULL DEFAULT 'blue',
  "blurb"        TEXT,
  "price"        INTEGER NOT NULL DEFAULT 0,
  "per_student"  INTEGER NOT NULL DEFAULT 0,
  "per_person"   INTEGER NOT NULL DEFAULT 0,
  "features"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "entitlements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "limit_people" INTEGER,
  "limit_gates"  INTEGER,
  "is_active"    BOOLEAN NOT NULL DEFAULT true,
  "sort_order"   INTEGER NOT NULL DEFAULT 0,
  "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_date" TIMESTAMP(3) NOT NULL,
  "created_by"   TEXT,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- Seed the four packages that were previously compiled in, so nothing changes
-- for schools already on them. ON CONFLICT keeps this safe to re-run.
INSERT INTO "plans" ("id","name","color","price","per_student","per_person","features","entitlements","limit_people","limit_gates","sort_order","updated_date") VALUES
 ('trial','Trial','gray',0,0,0,
  ARRAY['Up to 100 people','1 gate','14-day access'],
  ARRAY['access_logs','people'], 100, 1, 0, CURRENT_TIMESTAMP),
 ('basic','Basic','blue',45000,120,100,
  ARRAY['Up to 500 people','2 gates','Access logs & attendance'],
  ARRAY['access_logs','people','attendance','passes'], 500, 2, 1, CURRENT_TIMESTAMP),
 ('premium','Premium','violet',120000,250,200,
  ARRAY['Up to 2,000 people','Unlimited gates','Bus tracking, CRM, reports'],
  ARRAY['access_logs','people','attendance','passes','bus','messaging','reports'], 2000, NULL, 2, CURRENT_TIMESTAMP),
 ('enterprise','Enterprise','green',280000,400,320,
  ARRAY['Unlimited people','Multi-campus','Priority support & SLA'],
  ARRAY['access_logs','people','attendance','passes','bus','messaging','reports','crm','custom_roles','multi_campus'], NULL, NULL, 3, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
