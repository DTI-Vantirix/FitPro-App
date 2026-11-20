import { api } from '@/api/client';
import { zoneTemplate } from '@/lib/zones';

/** The signed-in user's profile, or null when nothing has been saved yet. */
export async function loadProfile() {
  const page = await api.entities.Profile.list({ sort: '-created_date', limit: 1 });
  return (page.items || [])[0] || null;
}

export async function saveProfile(values) {
  const existing = await loadProfile();
  if (existing) return api.entities.Profile.update(existing.id, values);
  return api.entities.Profile.create(values);
}

/** Writes the five zones for a threshold pace, replacing any previous set. */
export async function applyZones(thresholdSec) {
  const spec = zoneTemplate(thresholdSec);
  const page = await api.entities.PaceZone.list({ sort: 'fast_sec', limit: 40 });
  const existing = page.items || [];
  const byNumber = new Map(existing.map((zone) => [Number(zone.zone_number) || 0, zone]));
  const everyZonePresent = spec.every((s) => byNumber.has(s.zone_number));

  if (everyZonePresent && existing.length === spec.length) {
    const updated = await api.entities.PaceZone.bulkUpdate(
      spec.map((s) => ({ id: byNumber.get(s.zone_number).id, ...s }))
    );
    return Array.isArray(updated) ? updated : spec;
  }

  await Promise.all(existing.map((zone) => api.entities.PaceZone.delete(zone.id)));
  const created = await api.entities.PaceZone.bulkCreate(spec);
  return Array.isArray(created) ? created : created?.items || [];
}