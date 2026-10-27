/**
 * geofence.js — is this device at the school?
 *
 * The honest framing first, because it shapes every rule below: a phone
 * reports its own position, and a determined person can make it report
 * anything. This is therefore an attendance convenience, not a security
 * control. Nothing that matters for a child's safety is decided here — a
 * pupil's exit still needs a parent's live QR, a one-time pass or the bus, and
 * self check-in is confined to staff arriving.
 *
 * What the checks below do buy is that a *casual* "I'm at work" tap from home
 * does not succeed, and that every accepted check-in carries the coordinates
 * and accuracy the handset claimed, so a disputed record can be looked at.
 */

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two { latitude, longitude }. */
export function distanceMeters(a, b) {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const MIN_RADIUS_M = 50;      // below this, ordinary GPS drift locks people out
export const MAX_RADIUS_M = 2000;    // beyond this it stops meaning "at the school"
export const DEFAULT_RADIUS_M = 150;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** A centre is only usable if both coordinates are real and in range. */
export function hasCentre(school) {
  return (
    isNum(school?.latitude) && isNum(school?.longitude) &&
    Math.abs(school.latitude) <= 90 && Math.abs(school.longitude) <= 180 &&
    // 0,0 is in the Atlantic. It is what an unset pair of numeric fields looks
    // like far more often than it is a real campus.
    !(school.latitude === 0 && school.longitude === 0)
  );
}

export function radiusOf(school) {
  const r = school?.geofence_radius_m;
  if (!isNum(r)) return DEFAULT_RADIUS_M;
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(r)));
}

/**
 * Validate a centre an administrator typed in. Returns a coded problem or null.
 * Latitude and longitude being transposed is the usual mistake, and in Nigeria
 * it is a detectable one: longitude runs 2.6–14.7 and latitude 4–14, so a
 * latitude above 14 is almost certainly a swapped pair.
 */
export function validateCentre({ latitude, longitude, radius_m }) {
  if (!isNum(latitude) || !isNum(longitude)) {
    return { code: 'centre_required', message: 'Give the latitude and longitude of the campus.' };
  }
  if (Math.abs(latitude) > 90) {
    return { code: 'latitude_range', message: 'Latitude must be between -90 and 90.' };
  }
  if (Math.abs(longitude) > 180) {
    return { code: 'longitude_range', message: 'Longitude must be between -180 and 180.' };
  }
  if (latitude === 0 && longitude === 0) {
    return { code: 'centre_required', message: 'That is the middle of the Atlantic. Set the campus location.' };
  }
  if (isNum(radius_m) && (radius_m < MIN_RADIUS_M || radius_m > MAX_RADIUS_M)) {
    return {
      code: 'radius_range',
      message: `The radius must be between ${MIN_RADIUS_M}m and ${MAX_RADIUS_M}m.`,
    };
  }
  return null;
}

/**
 * Decide a check-in attempt.
 *
 * Returns { ok: true, distance_m, radius_m } or { ok: false, code, message, … }.
 * It never throws — the caller turns a refusal into the right HTTP status, and
 * every refusal carries a code so the app can say something specific.
 */
export function evaluateCheckIn({ school, position }) {
  if (!school?.self_checkin_enabled) {
    return { ok: false, code: 'disabled', message: 'Self check-in is not switched on for your school.' };
  }
  if (!hasCentre(school)) {
    return {
      ok: false, code: 'no_centre',
      message: 'Your school has not recorded its campus location yet. Ask your administrator to set it.',
    };
  }
  const { latitude, longitude, accuracy_m } = position || {};
  if (!isNum(latitude) || !isNum(longitude)) {
    return { ok: false, code: 'no_fix', message: 'We could not read your location. Try again outdoors.' };
  }

  const radius_m = radiusOf(school);
  const distance_m = Math.round(distanceMeters(school, { latitude, longitude }));

  /*
   * A fix is only worth testing if it is precise enough to distinguish inside
   * from outside. A reading accurate to ±1km "inside" a 150m fence tells you
   * nothing, and accepting it would make the fence decorative. The allowance is
   * the radius itself, capped, so a generous fence tolerates a vaguer fix.
   */
  const accuracyBudget = Math.min(radius_m, 250);
  if (isNum(accuracy_m) && accuracy_m > accuracyBudget) {
    return {
      ok: false, code: 'poor_accuracy', distance_m, radius_m, accuracy_m,
      message: `Your location is only accurate to about ${Math.round(accuracy_m)}m, which is too vague to confirm you are on campus. Step outside or turn on precise location.`,
    };
  }

  if (distance_m > radius_m) {
    return {
      ok: false, code: 'outside', distance_m, radius_m,
      message: `You are about ${formatDistance(distance_m)} from the campus. Check in once you arrive.`,
    };
  }
  return { ok: true, distance_m, radius_m, accuracy_m: isNum(accuracy_m) ? accuracy_m : null };
}

/** Metres under a kilometre, one decimal kilometre above it. */
export function formatDistance(m) {
  if (!isNum(m)) return '—';
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}
