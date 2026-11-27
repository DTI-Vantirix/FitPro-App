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
for (const f of ['app/index.tsx','app/spike.tsx','app/consent.tsx','app/invite.tsx','app/(tabs)/activities.tsx',
  'src/auth/session.tsx','src/auth/auth-api.ts',
  'src/access/invite-api.ts','src/access/access-gate.tsx'])
  assert(existsSync(join(native,f)), `Missing ${f}`);
const dir = join(native, 'app');
// (tabs) is the Expo Router group holding the signed-in tab screens; it changes no URL.
for (const file of readdirSync(dir)) assert(file.endsWith('.tsx') || file === '(tabs)', 'Unexpected runtime artifact in app/');
for (const file of readdirSync(join(dir, '(tabs)'))) assert(file.endsWith('.tsx'), 'Unexpected runtime artifact in app/(tabs)/');
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
const activities = readFileSync(join(native, 'app/(tabs)/activities.tsx'), 'utf8');
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
for (const f of ['app/signup.tsx', 'app/setup.tsx', 'app/(tabs)/home.tsx', 'app/settings.tsx', 'app/run-start.tsx', 'app/run-live.tsx', 'app/run-summary.tsx',
  'app/(tabs)/routes.tsx', 'app/route-new.tsx', 'app/(tabs)/analytics.tsx', 'app/zones.tsx',
  'app/(tabs)/feed.tsx', 'app/friends.tsx', 'app/social-profile.tsx', 'app/share-run.tsx', 'app/challenges.tsx', 'app/challenge.tsx'])
  assert(existsSync(join(native, f)), `Missing ${f}`);
// Every screen past sign-up sits behind the same three checks: sign-in, consent, invite.
for (const f of ['setup', '(tabs)/home', 'settings', 'run-start', 'run-live', 'run-summary', '(tabs)/routes', 'route-new', '(tabs)/analytics', 'zones',
  '(tabs)/feed', 'friends', 'social-profile', 'share-run', 'challenges', 'challenge']) {
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
// One exception, and it is a read: listServerRuns in src/run/api.ts lists the runner's own
// runs with a single POST .../Run/query. That exact call may appear once, in that file only;
// any other mention of the Run or Workout entity routes still fails.
const RUN_READ = "request('POST', entityUrl('Run', '/query'), { token, body: { q: mine(ownerId), sort: '-started_at', limit } })";
const runApiFile = join(native, 'src/run/api.ts');
assert(readFileSync(runApiFile, 'utf8').split(RUN_READ).length <= 2, 'Runs may be read by one query only.');
for (const file of [...runFiles, ...sourceFiles(join(native, 'src/social')), ...sourceFiles(join(native, 'app'))]) {
  const source = readFileSync(file, 'utf8');
  const text = file === runApiFile ? source.replace(RUN_READ, '') : source;
  assert(!/entities\/(Run|Workout)\b|entityUrl\('(Run|Workout)'/.test(text), `${file} writes runs outside ingestActivity.`);
  assert(!/HealthKit|health-connect|react-native-healthkit/.test(text) || !file.includes(`${sep}run${sep}`), `${file}: the run code must not request health permissions.`);
}
// The run logic is plain TypeScript: no React, React Native or Expo, so it is unit-tested as is.
const PURE = ['zones', 'geo', 'tracker', 'cues', 'directions', 'engine', 'payload', 'format', 'queue', 'hr-parse', 'controller', 'route-draft', 'dashboard', 'analytics'];
for (const name of PURE) {
  const text = readFileSync(join(native, `src/run/${name}.ts`), 'utf8');
  for (const [, spec] of text.matchAll(importPattern)) assert(spec.startsWith('./'), `src/run/${name}.ts must stay pure but imports ${spec}.`);
  assert(existsSync(join(native, 'scripts')), 'scripts folder missing');
}
// The social rules (audiences, the post record, handles, challenges) are plain TypeScript too.
for (const name of ['logic', 'challenges', 'media']) {
  const text = readFileSync(join(native, `src/social/${name}.ts`), 'utf8');
  for (const [, spec] of text.matchAll(importPattern)) assert(spec.startsWith('./'), `src/social/${name}.ts must stay pure but imports ${spec}.`);
}
// Social calls go to the VantraRun API only.
for (const file of sourceFiles(join(native, 'src/social'))) {
  assert(!/https?:\/\//.test(readFileSync(file, 'utf8')), `${file}: social code may only talk to the VantraRun API.`);
}
const socialLogic = readFileSync(join(native, 'src/social/logic.ts'), 'utf8');
assert(socialLogic.includes("return profile?.visibility === 'public' ? 'public' : 'friends';"), 'The default audience of a post must stay the website\'s: friends, public only for a public account.');
assert(socialLogic.includes("map((p) => ({ lat: p.lat, lng: p.lng }))"), 'A post sends only lat/lng for its route points.');
// ---- Posts with a photo or video background (owner, 2026-11-27) ----
// Of its media a post carries two fields, the website's: the kind and the address the server stored it at.
assert(socialLogic.includes("background_type: none ? 'none' : background.type,") && socialLogic.includes("background_url: none ? '' : background.url,"),
  'A post names its background by kind and address only, and "none" never carries an address.');
// Exactly two media packages: the system picker and the video player. Anything that reads the
// whole library, runs its own camera, picks arbitrary documents or records sound stays out.
const deps = Object.keys(pkg.dependencies);
assert(/^~58\./.test(pkg.dependencies['expo-image-picker'] ?? '') && /^~58\./.test(pkg.dependencies['expo-video'] ?? ''),
  'Media posts use expo-image-picker and expo-video at Expo SDK 58.');
assert(!deps.some((name) => /media-library|expo-camera|vision-camera|document-picker|image-crop-picker|react-native-image-picker|react-native-video|image-manipulator|expo-audio/i.test(name) || name === 'expo-av'),
  'Only expo-image-picker and expo-video are allowed for media: no media-library, camera, document-picker, audio or other video package.');
const appSources = [...sourceFiles(join(native, 'app')), ...sourceFiles(join(native, 'src'))];
const rel = (file) => file.slice(native.length + 1).split(sep).join('/');
const filesWith = (pattern) => appSources.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map(rel).sort();
const only = (pattern, files, message) => assert.deepEqual(filesWith(pattern), [...files].sort(), message);
// The picker is opened from one module, which only the composer uses; video is played by one component.
only(/['"]expo-image-picker['"]/, ['src/social/media-picker.ts'], 'expo-image-picker may be imported by src/social/media-picker.ts only.');
only(/['"]expo-video['"]/, ['src/social/ui/Media.tsx'], 'expo-video may be imported by src/social/ui/Media.tsx only.');
only(/media-picker['"]/, ['app/share-run.tsx'], 'Only the composer may open the photo picker or the camera.');
const picker = readFileSync(join(native, 'src/social/media-picker.ts'), 'utf8');
// Permission is asked at the tap, for the camera only. The library goes through the system
// picker, which needs none, so the photo-library permission is never requested anywhere.
assert(picker.split('requestCameraPermissionsAsync').length === 2 && /export async function takePhoto\(\)[\s\S]*requestCameraPermissionsAsync[\s\S]*launchCameraAsync/.test(picker),
  'The camera permission is asked once, inside takePhoto, just before the camera opens.');
only(/requestCameraPermissionsAsync|useCameraPermissions/, ['src/social/media-picker.ts'], 'Nothing but takePhoto may ask for the camera.');
only(/MediaLibraryPermissions/, [], 'The photo-library permission is never requested: the system picker needs none.');
assert(picker.includes('exif: false') && picker.includes('base64: false') && picker.includes("launchCameraAsync({ ...COMMON, mediaTypes: ['images'] })")
  && !/legacy:\s*true|allowsMultipleSelection:\s*true/.test(picker),
  'The picker returns one item, no EXIF and no file contents to JavaScript, and the camera takes photos only (no microphone).');
// Uploads: one route on our own server, one sender, called by the composer when Post is tapped.
only(/api\/uploads/, ['src/config.ts'], 'The upload address is defined once, in src/config.ts, from EXPO_PUBLIC_API_URL.');
only(/\bUPLOADS_URL\b/, ['src/config.ts', 'src/social/api.ts'], 'Only uploadMedia in src/social/api.ts may use the upload address.');
only(/\buploadMedia\(/, ['app/share-run.tsx', 'src/social/api.ts'], 'Media is uploaded from the composer only.');
only(/\.upload\(|createUploadTask|uploadAsync|UploadType|new FormData|FormData\(/, ['src/social/upload-file.ts'], 'Files are sent by src/social/upload-file.ts only.');
only(/\bsendFile\b/, ['app/share-run.tsx', 'src/social/upload-file.ts'], 'Only the composer may hand the file sender to uploadMedia.');
const composer = readFileSync(join(native, 'app/share-run.tsx'), 'utf8');
assert(composer.split('uploadMedia(').length === 2 && /async function post\(\) \{[\s\S]*uploadMedia\(me\.token, media, sendFile/.test(composer)
  && composer.indexOf('uploadMedia(') > composer.indexOf('async function post()') && composer.indexOf('uploadMedia(') < composer.indexOf('function shareOut('),
  'The composer uploads in one place: inside post(), which runs when the runner taps Post.');
// A feed can only make the phone fetch media from the VantraRun server itself.
const mediaRules = readFileSync(join(native, 'src/social/media.ts'), 'utf8');
assert(mediaRules.includes('const MEDIA_PATH = /^\\/(?:uploads\\/[0-9a-f-]{36}\\.[a-z0-9]{2,5}|backgrounds\\/[a-z0-9_-]+\\.jpg)$/;')
  && readFileSync(join(native, 'src/social/ui/Parts.tsx'), 'utf8').includes('backgroundOf(post, API_URL)'),
  'A post\'s background is shown only from /uploads or /backgrounds on the VantraRun API.');
const mediaView = readFileSync(join(native, 'src/social/ui/Media.tsx'), 'utf8');
assert(mediaView.includes('created.muted = true') && mediaView.includes("created.audioMixingMode = 'mixWithOthers'") && mediaView.includes('nativeControls={false}'),
  'A video background is muted and never takes the audio from music or the run coach.');
// Store review: every permission-gated API the picker links has an honest purpose string
// (a missing one rejected build 1, ITMS-90683), and Android asks for the camera and nothing more.
const pickerPlugin = cfg.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-image-picker')?.[1] ?? {};
const purpose = [pickerPlugin.photosPermission, pickerPlugin.cameraPermission, pickerPlugin.microphonePermission, cfg.expo.ios.infoPlist.NSPhotoLibraryAddUsageDescription];
assert(purpose.every((text) => typeof text === 'string' && text.length > 40 && /VantraRun/.test(text) && !/PRODUCT_NAME|^Allow /.test(text)),
  'Photo library, camera, microphone and add-to-library purpose strings must each be set and say what VantraRun does.');
assert(/does not record sound/.test(pickerPlugin.microphonePermission) && /does not save anything/.test(cfg.expo.ios.infoPlist.NSPhotoLibraryAddUsageDescription),
  'The app records no sound and saves nothing to the photo library, and its purpose strings must say so.');
for (const blocked of ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.RECORD_AUDIO']) {
  assert(cfg.expo.android.blockedPermissions.includes(blocked), `${blocked} must stay blocked on Android.`);
}
const videoPlugin = cfg.expo.plugins.find((plugin) => plugin === 'expo-video' || (Array.isArray(plugin) && plugin[0] === 'expo-video'));
assert(videoPlugin === 'expo-video', 'expo-video is configured with no options: no background playback, no picture in picture.');
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
