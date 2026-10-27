import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceMeters, evaluateCheckIn, validateCentre, radiusOf, hasCentre,
  formatDistance, MIN_RADIUS_M, MAX_RADIUS_M, DEFAULT_RADIUS_M,
} from '../src/lib/geofence.js';

/**
 * Staff self check-in by geofence. The phone reports its own position, so this
 * is an attendance convenience rather than a security control — these tests pin
 * the behaviour that stops it being merely decorative.
 */

// Ikeja, Lagos. The offsets below are derived from it, not guessed.
const CAMPUS = { latitude: 6.6018, longitude: 3.3515 };
const school = (over = {}) => ({
  ...CAMPUS, geofence_radius_m: 150, self_checkin_enabled: true, ...over,
});

/**
 * Metres north of a point, via the ~111,320 m per degree of latitude. That is a
 * flat approximation and the code under test is a proper haversine, so a
 * requested 900m comes back as 899 — assertions on these offsets allow a metre.
 */
const north = (m) => ({
  latitude: CAMPUS.latitude + m / 111320,
  longitude: CAMPUS.longitude,
});
const near = (actual, want, slack = 2) =>
  assert.ok(Math.abs(actual - want) <= slack, `expected ~${want}, got ${actual}`);

describe('distanceMeters', () => {
  test('is zero at the same point', () => {
    assert.equal(Math.round(distanceMeters(CAMPUS, CAMPUS)), 0);
  });

  test('matches a known offset to within a metre', () => {
    assert.ok(Math.abs(distanceMeters(CAMPUS, north(500)) - 500) < 1);
  });

  test('is symmetric', () => {
    const a = distanceMeters(CAMPUS, north(300));
    const b = distanceMeters(north(300), CAMPUS);
    assert.ok(Math.abs(a - b) < 0.001);
  });

  test('Lagos to Abuja is about 525km', () => {
    const abuja = { latitude: 9.0765, longitude: 7.3986 };
    const km = distanceMeters(CAMPUS, abuja) / 1000;
    assert.ok(km > 510 && km < 540, `got ${km.toFixed(1)}km`);
  });
});

describe('the fence', () => {
  test('accepts a precise fix inside it', () => {
    const r = evaluateCheckIn({ school: school(), position: { ...north(40), accuracy_m: 12 } });
    assert.equal(r.ok, true);
    near(r.distance_m, 40);
    assert.equal(r.radius_m, 150);
  });

  test('refuses a fix outside it, and says how far', () => {
    const r = evaluateCheckIn({ school: school(), position: { ...north(900), accuracy_m: 10 } });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'outside');
    near(r.distance_m, 900);
    assert.match(r.message, /\b89\d|90\dm/);
  });

  test('refuses a check-in from home', () => {
    const home = { latitude: 6.5244, longitude: 3.3792, accuracy_m: 20 };
    const r = evaluateCheckIn({ school: school(), position: home });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'outside');
  });

  /*
   * The one that stops the fence being decorative: a reading accurate to ±1km
   * can sit "inside" a 150m circle while telling you nothing at all.
   */
  test('refuses a fix too vague to mean anything, even when it reads as inside', () => {
    const r = evaluateCheckIn({ school: school(), position: { ...north(10), accuracy_m: 1200 } });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'poor_accuracy');
  });

  test('a generous fence tolerates a vaguer fix, up to the 250m cap', () => {
    const wide = school({ geofence_radius_m: 800 });
    assert.equal(evaluateCheckIn({ school: wide, position: { ...north(100), accuracy_m: 240 } }).ok, true);
    assert.equal(
      evaluateCheckIn({ school: wide, position: { ...north(100), accuracy_m: 300 } }).code,
      'poor_accuracy'
    );
  });

  test('accepts a fix with no accuracy reported rather than blocking the person', () => {
    const r = evaluateCheckIn({ school: school(), position: north(20) });
    assert.equal(r.ok, true);
    assert.equal(r.accuracy_m, null);
  });

  test('refuses when the school has not switched it on', () => {
    const r = evaluateCheckIn({ school: school({ self_checkin_enabled: false }), position: { ...north(10), accuracy_m: 5 } });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'disabled');
  });

  /* A school with no centre must not get a fence that accepts everything. */
  test('refuses when no centre has been recorded', () => {
    const r = evaluateCheckIn({
      school: { self_checkin_enabled: true, latitude: null, longitude: null },
      position: { ...north(10), accuracy_m: 5 },
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'no_centre');
  });

  test('treats 0,0 as unset rather than as a campus in the Atlantic', () => {
    assert.equal(hasCentre({ latitude: 0, longitude: 0 }), false);
    const r = evaluateCheckIn({
      school: { latitude: 0, longitude: 0, self_checkin_enabled: true },
      position: { latitude: 0, longitude: 0, accuracy_m: 5 },
    });
    assert.equal(r.code, 'no_centre');
  });

  test('refuses when the device has no fix', () => {
    assert.equal(evaluateCheckIn({ school: school(), position: {} }).code, 'no_fix');
    assert.equal(evaluateCheckIn({ school: school(), position: null }).code, 'no_fix');
  });

  test('a NaN latitude is not a fix', () => {
    const r = evaluateCheckIn({ school: school(), position: { latitude: NaN, longitude: 3.35, accuracy_m: 5 } });
    assert.equal(r.code, 'no_fix');
  });
});

describe('radius', () => {
  test('falls back to the default when unset', () => {
    assert.equal(radiusOf({}), DEFAULT_RADIUS_M);
    assert.equal(radiusOf({ geofence_radius_m: null }), DEFAULT_RADIUS_M);
  });

  test('clamps below the floor, so GPS drift cannot lock staff out', () => {
    assert.equal(radiusOf({ geofence_radius_m: 5 }), MIN_RADIUS_M);
  });

  test('clamps above the ceiling, so the fence keeps meaning "at the school"', () => {
    assert.equal(radiusOf({ geofence_radius_m: 50000 }), MAX_RADIUS_M);
  });
});

describe('validateCentre', () => {
  test('accepts a real campus', () => {
    assert.equal(validateCentre({ ...CAMPUS, radius_m: 150 }), null);
  });

  test('requires both coordinates', () => {
    assert.equal(validateCentre({ latitude: 6.6 }).code, 'centre_required');
    assert.equal(validateCentre({}).code, 'centre_required');
  });

  test('rejects out-of-range values', () => {
    assert.equal(validateCentre({ latitude: 91, longitude: 3 }).code, 'latitude_range');
    assert.equal(validateCentre({ latitude: 6, longitude: 181 }).code, 'longitude_range');
  });

  test('rejects a radius outside the usable band', () => {
    assert.equal(validateCentre({ ...CAMPUS, radius_m: 10 }).code, 'radius_range');
    assert.equal(validateCentre({ ...CAMPUS, radius_m: 99999 }).code, 'radius_range');
  });
});

describe('formatDistance', () => {
  test('metres below a kilometre, kilometres above', () => {
    assert.equal(formatDistance(140), '140m');
    assert.equal(formatDistance(999), '999m');
    assert.equal(formatDistance(1500), '1.5km');
  });
  test('survives a missing value', () => {
    assert.equal(formatDistance(undefined), '—');
  });
});
