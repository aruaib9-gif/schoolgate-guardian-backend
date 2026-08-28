import { refreshPlans, getPlans } from './plans.js';

/**
 * Editing the package catalog.
 *
 * Packages were a hardcoded constant, so a price change or a new package meant
 * a deploy, and a school that fitted none of them had to be forced into one.
 * The rules that make editing safe live here:
 *
 *   - A package id is permanent. Schools store it on `subscription_plan`, so
 *     renaming the id would silently unbill every school on that package. The
 *     display name is free to change; the id is not.
 *   - Packages are retired, never deleted, while any school is still on one.
 *     Deleting would leave those schools pointing at nothing.
 *   - Entitlements are validated against the real capability list, so a package
 *     cannot promise a feature the API has never heard of.
 */
const ID_RE = /^[a-z][a-z0-9_]{1,30}$/;

const int = (v, min = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min ? n : 0;
};
// null means unlimited, which is different from zero.
const capOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const strList = (v, max = 24) =>
  (Array.isArray(v) ? v : String(v ?? '').split('\n'))
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, max);

export function validateId(id) {
  const key = String(id || '').trim().toLowerCase();
  if (!ID_RE.test(key)) {
    return { error: 'An id must be lowercase letters, digits or underscores — for example "standard_termly".' };
  }
  return { key };
}

/** Shape a request body into a row, keeping ids and unknown features out. */
export function planData(body, { validFeatureIds }) {
  const name = String(body?.name || '').trim().slice(0, 60);
  if (!name) return { error: 'Give the package a name.' };

  const entitlements = strList(body?.entitlements, 40).filter((f) => validFeatureIds.has(f));
  const unknown = strList(body?.entitlements, 40).filter((f) => !validFeatureIds.has(f));
  if (unknown.length) {
    return { error: `This product has no feature called ${unknown.join(', ')}.` };
  }

  return {
    data: {
      name,
      color: String(body?.color || 'blue').trim().slice(0, 20),
      blurb: String(body?.blurb || '').trim().slice(0, 200) || null,
      price: int(body?.price),
      per_student: int(body?.per_student),
      per_person: int(body?.per_person),
      features: strList(body?.features),
      entitlements,
      limit_people: capOrNull(body?.limit_people),
      limit_gates: capOrNull(body?.limit_gates),
      is_active: body?.is_active !== false,
      sort_order: int(body?.sort_order),
    },
  };
}

/** How many schools are on a package — decides whether it may be deleted. */
export async function schoolsOnPlan(prisma, planId) {
  return prisma.school.count({ where: { subscription_plan: planId } });
}

/** Re-read the catalog into memory. Call after every mutation. */
export async function syncCatalog(prisma) {
  await refreshPlans(prisma);
  return getPlans();
}
