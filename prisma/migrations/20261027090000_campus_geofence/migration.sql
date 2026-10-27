-- Campus geofence for staff self check-in.
--
-- The centre is nullable on purpose: a school that has not recorded one must
-- not get a fence that accepts everything. `self_checkin_enabled` defaults to
-- false so the feature is opt-in per school rather than appearing unannounced
-- for every school on the platform.
ALTER TABLE "schools"
  ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "geofence_radius_m" INTEGER DEFAULT 150,
  ADD COLUMN IF NOT EXISTS "self_checkin_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Where the device said it was when a self check-in was accepted. Kept for
-- dispute resolution; it is what the handset reported, not proof of presence.
ALTER TABLE "access_logs"
  ADD COLUMN IF NOT EXISTS "device_latitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "device_longitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "device_accuracy_m" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "distance_m" DOUBLE PRECISION;
