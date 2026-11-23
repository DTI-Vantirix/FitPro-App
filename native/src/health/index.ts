import type { HealthAdapter } from './types';
import { fakeHealthAdapter } from './fake-adapter';
import { appleHealthAdapter, isAppleHealthBuildAvailable } from './apple-adapter';
import { androidHealthAdapter, isAndroidHealthBuildAvailable } from './android-adapter';

// All health data access is routed through this selector/interface.
// The UI defaults to fake records. Both OS providers require explicit consent,
// a verified invite, an on-screen selection, and an OS permission request.
export function getHealthAdapter(provider: 'fake' | 'apple' | 'health_connect'): HealthAdapter {
  return provider === 'apple' ? appleHealthAdapter : provider === 'health_connect' ? androidHealthAdapter : fakeHealthAdapter;
}

export { fakeHealthAdapter, isAppleHealthBuildAvailable, isAndroidHealthBuildAvailable };
export type { HealthAdapter, NormalizedActivity, NormalizedRun, NormalizedWorkout } from './types';
