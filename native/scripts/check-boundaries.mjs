import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

const native = resolve(import.meta.dirname, '..');
const root = resolve(native, '..');
// The shell lives beside server/ and web/ in one repo but must stay independent of both:
// no import may resolve outside native/, and nothing may name the server or web packages.
const sourceFiles = (dir) => readdirSync(dir).flatMap((name) => {
  if (name === 'node_modules' || name.startsWith('.')) return [];
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return sourceFiles(path);
  return /\.(?:[cm]?[jt]sx?)$/.test(name) ? [path] : [];
});
const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
for (const file of [...sourceFiles(join(native, 'app')), ...sourceFiles(join(native, 'src')), join(native, 'index.js')]) {
  for (const [, spec] of readFileSync(file, 'utf8').matchAll(importPattern)) {
    assert(!/^(?:@fitpro\/|fitpro-)?(?:server|web)(?:\/|$)/.test(spec), `${file} imports the ${spec} package.`);
    if (!spec.startsWith('.')) continue;
    const target = resolve(file, '..', spec);
    assert(target === native || target.startsWith(native + sep), `${file} imports ${spec}, which is outside native/ (../server and ../web are forbidden).`);
  }
}
for (const file of [...sourceFiles(join(native, 'app')), ...sourceFiles(join(native, 'src'))]) {
  assert(!/base44\.app/i.test(readFileSync(file, 'utf8')), `${file} still points at a Base44 URL.`);
}
const config = readFileSync(join(native, 'src/config.ts'), 'utf8');
assert(config.includes('process.env.EXPO_PUBLIC_API_URL') && !/https?:\/\//.test(config.replace(/\/\*[\s\S]*?\*\//g, '')),
  'The API address must come from EXPO_PUBLIC_API_URL, never a hard-coded URL.');
assert(existsSync(join(root, 'server')) && existsSync(join(root, 'web')), 'Expected to run inside the FitPro repo, beside server/ and web/.');
const workout = readFileSync(join(native, 'src/ingestion/spike-workout.ts'), 'utf8');
for (const name of ['external_id', 'kind', 'source', 'exercises']) assert(workout.includes(name), `Missing ${name}`);
assert(!workout.includes('total_volume') && !workout.includes('set_count'), 'Server-computed fields are prohibited.');
for (const f of ['app/index.tsx','app/spike.tsx','app/consent.tsx','app/invite.tsx','app/activities.tsx',
  'src/auth/session.tsx','src/auth/auth-api.ts',
  'src/access/invite-api.ts','src/access/access-gate.tsx'])
  assert(existsSync(join(native,f)), `Missing ${f}`);
const dir = join(native, 'app');
for (const file of readdirSync(dir)) assert(file.endsWith('.tsx'), 'Unexpected runtime artifact in app/');
const invite = readFileSync(join(native, 'src/access/invite-api.ts'), 'utf8');
const gate = readFileSync(join(native, 'src/access/access-gate.tsx'), 'utf8');
const session = readFileSync(join(native, 'src/auth/session.tsx'), 'utf8');
const spike = readFileSync(join(native, 'app/spike.tsx'), 'utf8');
assert(invite.includes('${API_URL}/api/functions/inviteAccess'), 'Invite checks must use the FitPro API inviteAccess function.');
assert(invite.includes("action: 'status'") && invite.includes("action: 'redeem'"), 'Step 2 uses only existing invite actions.');
assert(gate.includes("status: 'needs_invite'") && gate.includes("status: 'allowed'"), 'Backend gate missing.');
assert(session.includes('SecureStore.setItemAsync(CONSENT_KEY') && session.includes('SecureStore.deleteItemAsync(CONSENT_KEY'), 'Consent must persist and be revocable.');
assert(spike.includes("accessStatus !== 'allowed'"), 'Spike writes must be gated by invite status.');
for (const file of ['src/health/types.ts', 'src/health/fake-adapter.ts', 'src/health/index.ts']) {
  assert(existsSync(join(native, file)), `Step 3 missing ${file}`);
}
const adapter = readFileSync(join(native, 'src/health/index.ts'), 'utf8');
const fake = readFileSync(join(native, 'src/health/fake-adapter.ts'), 'utf8');
const healthTypes = readFileSync(join(native, 'src/health/types.ts'), 'utf8');
const activities = readFileSync(join(native, 'app/activities.tsx'), 'utf8');
assert(adapter.includes('getHealthAdapter') && adapter.includes('fakeHealthAdapter') && adapter.includes('appleHealthAdapter') && adapter.includes('androidHealthAdapter'), 'All three providers must use one adapter selector.');
assert(healthTypes.includes('interface HealthAdapter') && healthTypes.includes('readActivities()'), 'Single health read interface missing.');
assert(activities.includes('adapter.readActivities()'), 'Activity screen must read through adapter interface.');
assert(activities.includes("const authorized = Boolean(accessToken && consentAccepted && accessStatus === 'allowed')"), 'Health reads must require consent and confirmed invite.');
assert(activities.includes('if (!consentAccepted)') && activities.includes("accessStatus === 'needs_invite'"), 'Activities must be protected against navigation bypass.');
assert(spike.includes("router.push('/activities')"), 'Step 3 activities navigation missing.');
assert(!/(?:from|require\s*\()\s*['"](?:react-native-health-connect|react-native-health|expo-healthkit|@kingstinct\/react-native-healthkit)/.test(fake), 'Fake adapter must not import real health SDKs.');
const pkg = JSON.parse(readFileSync(join(native, 'package.json'), 'utf8'));
assert(pkg.dependencies['@kingstinct/react-native-healthkit'] === '16.2.0', 'Expected pinned HealthKit package.');
assert(pkg.dependencies['react-native-nitro-modules'] === '0.37.2', 'Expected pinned Nitro modules.');
assert(/^~58\.0\.\d+$/.test(pkg.dependencies['expo-dev-client']), 'Missing SDK 58 Expo development client.');
assert(pkg.dependencies['react-native-health-connect'] === '4.1.3', 'Expected pinned Android Health Connect package.');
assert(/^~58\.0\.\d+$/.test(pkg.dependencies['expo-build-properties']), 'Expected Expo SDK 58 build properties plugin.');
assert(!Object.keys(pkg.dependencies).some((name) => /analytics|sentry|posthog|supabase|expo-health-connect/i.test(name)), 'Unexpected data collection or deprecated Android Health dependency.');
const cfg = JSON.parse(readFileSync(join(native, 'app.json'), 'utf8'));
const healthPlugin = cfg.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === '@kingstinct/react-native-healthkit');
assert(healthPlugin && healthPlugin[1].background === true && /does not save anything to Apple Health/.test(healthPlugin[1].NSHealthUpdateUsageDescription),
  'Read-only HealthKit: Apple rejects a build without the write purpose string (ITMS-90683), and it must say nothing is written.');
const apple = readFileSync(join(native, 'src/health/apple-adapter.ts'), 'utf8');
assert(apple.includes('hk.requestAuthorization') && apple.includes('toRead:'), 'Apple Health read authorization missing.');
assert(!apple.includes('toShare:') && !apple.includes('saveWorkoutSample') && !apple.includes('enableBackgroundDelivery'), 'No write/background features allowed.');
const android = readFileSync(join(native, 'src/health/android-adapter.ts'), 'utf8');
assert(android.includes('hc.requestPermission') && android.includes('hc.getGrantedPermissions'), 'Android permission handling missing.');
assert(android.includes('ExerciseSession') && android.includes('Distance') && android.includes('HeartRate'), 'Android activity data types missing.');
for (const forbidden of [/insertRecords\s*\(/, /deleteRecords\s*\(/, /revokeAllPermissions\s*\(/, /getChanges\s*\(/, /BackgroundAccessPermission/, /ReadHealthDataHistory/, /writeExerciseRoute/, /requestExerciseRoute\s*\(/]) {
  assert(!forbidden.test(android), 'Android adapter contains a forbidden write/background/history/automatic-route operation.');
}
const allowed = new Set(['android.permission.health.READ_EXERCISE','android.permission.health.READ_DISTANCE','android.permission.health.READ_HEART_RATE','android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND']);
assert(cfg.expo.android.permissions.length === allowed.size && cfg.expo.android.permissions.every((p) => allowed.has(p)), 'Android permissions must contain exactly exercise, distance, heart rate, and background read permissions.');
assert(cfg.expo.plugins.includes('react-native-health-connect'), 'Android Expo Health Connect plugin missing.');
const buildProp = cfg.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
assert(buildProp?.[1]?.android?.minSdkVersion === 26 && buildProp?.[1]?.android?.targetSdkVersion === 36,
  'Android Health Connect requires min API 26 and compatible target SDK.');
assert(!activities.includes('sendSyntheticWorkout') && !activities.includes('ingestActivity'), 'Real activities screen cannot upload data in Step 5.');
// ---- Stage 1B: the run experience ----
for (const f of ['app/signup.tsx', 'app/setup.tsx', 'app/home.tsx', 'app/settings.tsx', 'app/run-start.tsx', 'app/run-live.tsx', 'app/run-summary.tsx'])
  assert(existsSync(join(native, f)), `Missing ${f}`);
// Every screen past sign-up sits behind the same three checks: sign-in, consent, invite.
for (const f of ['setup', 'home', 'settings', 'run-start', 'run-live', 'run-summary']) {
  const screen = readFileSync(join(native, `app/${f}.tsx`), 'utf8');
  assert(/export default function \w+\(\) \{\s*return <Gated/.test(screen), `app/${f}.tsx must render inside <Gated>.`);
}
const gateSource = readFileSync(join(native, 'src/run/ui/Screen.tsx'), 'utf8');
assert(gateSource.includes('if (!accessToken) return <Redirect href="/" />') && gateSource.includes('if (!consentAccepted) return <Redirect href="/consent" />')
  && gateSource.includes("status === 'needs_invite' || status === 'blocked'"), 'The run gate must check sign-in, consent and invite, in that order.');
// Sign-up asks for nothing from the phone: no health, location, Bluetooth or notification permission.
const signup = readFileSync(join(native, 'app/signup.tsx'), 'utf8');
assert(!/expo-location|react-native-ble-plx|expo-notifications|health/i.test(signup.replace(/\/\*\*[\s\S]*?\*\//, '')), 'Sign-up must not touch device permissions.');
// Runs are written through ingestActivity only; never the generic entity routes.
const runFiles = sourceFiles(join(native, 'src/run'));
for (const file of [...runFiles, ...sourceFiles(join(native, 'app'))]) {
  const text = readFileSync(file, 'utf8');
  assert(!/entities\/(Run|Workout)\b|entityUrl\('(Run|Workout)'/.test(text), `${file} writes runs outside ingestActivity.`);
  assert(!/HealthKit|health-connect|react-native-healthkit/.test(text) || !file.includes(`${sep}run${sep}`), `${file}: the run code must not request health permissions.`);
}
// The run logic is plain TypeScript: no React, React Native or Expo, so it is unit-tested as is.
const PURE = ['zones', 'geo', 'tracker', 'cues', 'directions', 'engine', 'payload', 'format', 'queue', 'hr-parse', 'controller'];
for (const name of PURE) {
  const text = readFileSync(join(native, `src/run/${name}.ts`), 'utf8');
  for (const [, spec] of text.matchAll(importPattern)) assert(spec.startsWith('./'), `src/run/${name}.ts must stay pure but imports ${spec}.`);
  assert(existsSync(join(native, 'scripts')), 'scripts folder missing');
}
const autoPolicy = readFileSync(join(native, 'src/ingestion/auto-import-policy.ts'), 'utf8');
assert(/AUTO_HEALTH_IMPORT_ENABLED = false;/.test(autoPolicy), 'Automatic health import must stay off in Stage 1 (duplicate runs).');
assert(readFileSync(join(native, 'src/ingestion/manual-import-panel.tsx'), 'utf8').includes('AUTO_HEALTH_IMPORT_ENABLED'), 'The import panel must honour the automatic-import switch.');
const payloadSource = readFileSync(join(native, 'src/run/payload.ts'), 'utf8');
assert(payloadSource.includes("source: 'fitpro'") && !/avg_pace_sec\s*:/.test(payloadSource), 'Run payload must be source "fitpro" and never send server-computed pace.');
assert(readFileSync(join(native, 'app/run-start.tsx'), 'utf8').includes('Crypto.randomUUID()'), 'external_id must be generated when the run starts.');
assert(readFileSync(join(native, 'app/settings.tsx'), 'utf8').includes('deleteAccount(accessToken, password)'), 'Native account deletion missing.');
// Store identity (owner, 2026-11-25). A bundle id can never change once the store apps exist.
assert(cfg.expo.ios.bundleIdentifier === 'com.vantrarun.app' && cfg.expo.android.package === 'com.vantrarun.app', 'Bundle id and package must be com.vantrarun.app.');
assert(cfg.expo.name === 'VantraRun', 'The app is called VantraRun.');
// Secrets never live in the repository: the Android map key arrives through app.config.js at build time.
assert(!JSON.stringify(cfg).includes('googleMaps') && !/AIza[0-9A-Za-z_-]{20,}/.test(JSON.stringify(cfg)), 'No map key in app.json.');
assert(readFileSync(join(native, 'app.config.js'), 'utf8').includes('process.env.GOOGLE_MAPS_ANDROID_KEY'), 'app.config.js must read the Android map key from the environment.');
const eas = JSON.parse(readFileSync(join(native, 'eas.json'), 'utf8'));
for (const profile of ['preview', 'production']) {
  assert(/^https:\/\/[a-z0-9.-]+$/.test(eas.build?.[profile]?.env?.EXPO_PUBLIC_API_URL ?? ''), `eas.json ${profile} must name the hosted API by an https address.`);
}
assert(eas.build.development?.developmentClient === true && eas.build.production?.autoIncrement === true, 'eas.json profiles are incomplete.');
// Crash reports go to our own API and nowhere else.
const reporter = readFileSync(join(native, 'src/diagnostics/error-reports.ts'), 'utf8');
assert(reporter.includes('`${API_URL}/api/client-errors`') && !/https?:\/\//.test(reporter), 'Error reports may only go to the FitPro API.');
assert(cfg.expo.ios.infoPlist.UIBackgroundModes.includes('location'), 'Background location mode missing: runs would stop when the screen locks.');
const locationPlugin = cfg.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-location');
assert(locationPlugin?.[1]?.isIosBackgroundLocationEnabled && locationPlugin?.[1]?.isAndroidForegroundServiceEnabled, 'Background location is not configured.');
assert(/^~58\./.test(pkg.dependencies['expo-location']) && /^~58\./.test(pkg.dependencies['expo-notifications']) && /^~58\./.test(pkg.dependencies['expo-speech']),
  'Run libraries must match Expo SDK 58.');
console.log('PASS: native-only, access gate, fake/Apple/Android adapters, read-only OS permissions, no health writes/background/uploads.');
