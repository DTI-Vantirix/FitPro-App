/**
 * The single platform-neutral shape for READS from a health provider.
 * Field names map to existing ingestActivity contract concepts, but Step 3
 * deliberately does not serialize or upload any of these activities.
 * Do not add a backend field based on this client-side type.
 */
export type ActivitySource = 'apple' | 'health_connect' | 'garmin' | 'manual';

export type NormalizedRun = {
  kind: 'run';
  externalId: string;
  source: ActivitySource;
  startedAt: string;
  routeName: string;
  distanceMi: number;
  durationSec: number;
  points?: ReadonlyArray<{ lat: number; lng: number }>;
  splits?: ReadonlyArray<{ mile: number; paceSec: number }>;
  avgHr?: number;
  maxHr?: number;
  hrDevice?: string;
  notes?: string;
};

export type NormalizedWorkout = {
  kind: 'workout';
  externalId: string;
  source: ActivitySource;
  name: string;
  performedAt: string;
  durationMin?: number;
  exercises: ReadonlyArray<{
    name: string;
    muscle?: string;
    sets: ReadonlyArray<{ reps: number; weight: number }>;
  }>;
  notes?: string;
};

export type NormalizedActivity = NormalizedRun | NormalizedWorkout;

/**
 * All native health reads must go through this interface. The active adapter
 * may be fake, Apple Health (iOS), or Android Health Connect in Step 5.
 */
export interface HealthAdapter {
  readonly id: 'fake' | 'apple' | 'health_connect';
  readonly displayName: string;
  readActivities(): Promise<ReadonlyArray<NormalizedActivity>>;
  /** Only available on providers requiring explicit OS read authorization. */
  requestReadAuthorization?(): Promise<void>;
  /** Nonfatal missing data or optional-route/heart-rate query failures. */
  getReadWarnings?(): ReadonlyArray<string>;
}
