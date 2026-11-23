/** Step 7B.2C policy tests plus additive wiring and fail-closed regression checks. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(import.meta.dirname, '..');
const source = (p) => readFileSync(resolve(root, p), 'utf8');
function load(file, deps = {}) {
  const translated = ts.transpileModule(source(file), {
    fileName:file, compilerOptions:{ module: ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, strict:true },
    reportDiagnostics:true,
  });
  const bad = (translated.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(bad.length,0,`TypeScript syntax errors in ${file}`);
  const module = { exports:{} };
  vm.runInNewContext(translated.outputText,{module,exports:module.exports, require:(name)=>{
    if (!(name in deps)) throw Error(`Unexpected test dependency: ${name} in ${file}`);
    return deps[name];
  },Math,Number,Date,Set,JSON,Array,String,Object,console},{ filename:file });
  return module.exports;
}
const mark = (key) => {let a=0x811c9dc5,b=0x72a5b2d1;for(const c of key){const v=c.charCodeAt(0);a=Math.imul(a^v,0x01000193)>>>0;b=Math.imul(b^v,0x27d4eb2d)>>>0;}return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');};
const validate = (run) => {
  if (run.kind !== 'run' || !['apple','health_connect'].includes(run.source)||!run.externalId||!(run.distanceMi>0)||!(run.durationSec>0))throw Error('invalid');
};
const safe=load('src/ingestion/background-sync-safe.ts',{
  './activity-sync': { activitySyncKey:(r)=>`${r.source}:${r.externalId}`, buildActivityPayload:validate },
  './auto-sync-state': { activityMark:mark },
});
const start='2026-11-13T12:00:00Z', end='2026-11-13T12:30:00Z';
const ex={startTime:start,endTime:end,exerciseType:56,title:'Real run',metadata:{id:'stable-hc-uuid',dataOrigin:'writer-a'}};
const dist={startTime:start,endTime:end,distance:{inMeters:3218.688},metadata:{dataOrigin:'writer-a'}};
const output=safe.strictAndroidBackgroundRun(ex,[dist],[ex]);
assert.equal(output?.externalId,'stable-hc-uuid');
assert.equal(output?.distanceMi,2);
assert.equal(output?.points,undefined,'No GPS route in pilot');
assert.equal(output?.avgHr,undefined,'No HR in pilot');
assert.equal(safe.strictAndroidBackgroundRun(ex,[{...dist,startTime:'2026-11-13T12:00:08Z',endTime:'2026-11-13T12:30:23Z'}],[ex])?.externalId,
  'stable-hc-uuid','Same-clock-minute differences must be accepted at BOTH interval boundaries');
assert.equal(safe.strictAndroidBackgroundRun(ex,[{...dist,startTime:'2026-11-13T12:00:59.999Z',endTime:'2026-11-13T12:30:59.999Z'}],[ex])?.externalId,
  'stable-hc-uuid','Full-minute tolerance is not capped at 15 seconds');
assert.equal(safe.strictAndroidBackgroundRun(ex,[{...dist,startTime:'2026-11-13T12:01:00Z'}],[ex]),null,
  'Moving to the NEXT clock minute must fail even if close in seconds');
assert.equal(safe.strictAndroidBackgroundRun(ex,[{...dist,endTime:'2026-11-13T12:29:59.999Z'}],[ex]),null,
  'Moving to the PREVIOUS clock minute at the end must fail');
assert.equal(safe.strictAndroidBackgroundRun(ex,[{...dist,startTime:'invalid'}],[ex]),null,'Invalid timestamp rejected');
assert.equal(safe.strictAndroidBackgroundRun(ex,[{...dist,startTime:end}],[ex]),null,'Zero-duration distance rejected');
const shortEx={...ex,startTime:'2026-11-13T12:00:00Z',endTime:'2026-11-13T12:00:59Z'};
assert.equal(safe.strictAndroidBackgroundRun(shortEx,[{...dist,startTime:'2026-11-13T12:00:58Z',endTime:'2026-11-13T12:00:59Z'}],[shortEx]),null,
  'A one-second partial distance must not be treated as a full run');
assert.equal(safe.strictAndroidBackgroundRun(ex,[{...dist,startTime:'2026-11-13T12:00:05Z',endTime:'2026-11-13T12:30:04Z'}],
  [ex,{...ex,startTime:'2026-11-13T12:00:06Z',endTime:'2026-11-13T12:30:09Z',metadata:{id:'another',dataOrigin:'writer-b'}}]),null,
  'Competing same-minute workout is ambiguous even when sources differ');
assert.equal(safe.strictAndroidBackgroundRun(ex,[{...dist,metadata:{dataOrigin:'other'}}],[ex]),null,'Cross-writer distance rejected');
assert.equal(safe.strictAndroidBackgroundRun(ex,[dist,dist],[ex]),null,'Duplicate distance ambiguous');
assert.equal(safe.strictAndroidBackgroundRun(ex,[dist,{...dist,startTime:'2026-11-13T12:05:00Z',endTime:'2026-11-13T12:06:00Z'}],[ex]),null,'Second same-writer partial distance rejected');
assert.equal(safe.strictAndroidBackgroundRun(ex,[dist,{...dist,startTime:'2026-11-13T11:59:59Z',endTime:'2026-11-13T12:00:12Z'}],[ex]),null,
  'Extra same-writer distance overlapping the selected distance is ambiguous');
assert.equal(safe.strictAndroidBackgroundRun(ex,[dist],[ex,{...ex,metadata:{id:'overlap'},startTime:'2026-11-13T12:20:00Z'}]),null,'Overlapping exercises rejected');
assert.equal(safe.strictAndroidBackgroundRun({...ex,metadata:{dataOrigin:'writer-a'}},[dist],[ex]),null,'Missing stable ID rejected');
assert.equal(safe.strictAndroidBackgroundRun({...ex,exerciseType:78},[dist],[ex]),null,'Not a running session');
const now=Date.parse('2026-11-13T14:00:00Z');
const old={...output,externalId:'old',startedAt:'2026-11-13T08:00:00Z'};
const future={...output,externalId:'future',startedAt:'2026-11-13T14:30:00Z'};
const apple={...output,externalId:'apple',source:'apple'};
const eligible=safe.selectSafeBackgroundPilot([old,output,apple,future], 'health_connect',
  '2026-11-13T09:00:00Z', [], [], [], now);
assert.equal(eligible.length,1);
assert.equal(eligible[0].externalId,'stable-hc-uuid');
assert.equal(safe.selectSafeBackgroundPilot([output], 'apple','2026-11-13T09:00:00Z',[],[],[],now).length,0);
assert.equal(safe.selectSafeBackgroundPilot([output], 'health_connect','2026-11-13T14:00:00Z',[],[],[],now).length,0);
const key='health_connect:stable-hc-uuid';
assert.equal(safe.selectSafeBackgroundPilot([output], 'health_connect','2026-11-13T09:00:00Z',[mark(key)],[],[],now).length,0);
assert.equal(safe.selectSafeBackgroundPilot([output], 'health_connect','2026-11-13T09:00:00Z',[],[{activityKey:key,outcome:'created'}],[],now).length,0);
assert.equal(safe.selectSafeBackgroundPilot([output], 'health_connect','2026-11-13T09:00:00Z',[],[],[mark(key)],now).length,0);
const pilot=source('src/ingestion/background-sync-pilot.ts');
const panel=source('src/ingestion/background-sync-pilot-panel.tsx');
const entry=source('index.js');
const activityScreen=source('app/activities.tsx');
const session=source('src/auth/session.tsx');
const adapter=source('src/health/android-adapter.ts');
const pkg=JSON.parse(source('package.json'));
const app=JSON.parse(source('app.json')).expo;
assert.equal(safe.BACKGROUND_PILOT_BATCH,1);
assert(pilot.includes("FITPRO_BACKGROUND_SYNC_TASK = 'fitpro-background-sync-pilot-v1'"));
assert(pilot.includes('TaskManager.defineTask(FITPRO_BACKGROUND_SYNC_TASK'));
assert(pilot.includes('BackgroundTask.registerTaskAsync(FITPRO_BACKGROUND_SYNC_TASK'));
assert(pilot.includes('BackgroundTask.unregisterTaskAsync(FITPRO_BACKGROUND_SYNC_TASK'));
assert(pilot.includes('BackgroundAccessPermission') && pilot.includes('hc.requestPermission(['));
assert(pilot.includes('hk.requestAuthorization({ toRead: [hk.WorkoutTypeIdentifier] })'));
assert(pilot.includes('hk.configureBackgroundTypes(['));
assert(pilot.includes('await getInviteStatus(token)') && pilot.includes('const invited = await getInviteStatus(token)'));
assert(pilot.includes('nextToken === token') && pilot.includes("nextConsent === 'accepted:v1'"));
assert(pilot.includes('if (!await gate(setting!, token)) return;'));
assert(pilot.includes('submitHealthActivity(run, token)') && pilot.includes('await pause(setting!, provider, \'upload_failed_paused\''));
assert(pilot.includes('strictAndroidBackgroundRun('));
assert(pilot.includes('Math.floor(from / 60_000)') && pilot.includes('Math.floor(to / 60_000)'),
  'Health Connect query must include both complete boundary minutes');
assert(panel.includes('BOTH start times fall in the same clock minute') && panel.includes('BOTH end times fall in the same clock minute'));
assert(source('src/ingestion/background-sync-safe.ts').includes('minute(dStart) === minute(start)'));
assert(!source('src/ingestion/background-sync-safe.ts').includes('Math.abs(dStart - start) <= 15_000'));

assert(!/saveWorkoutSample|writeExerciseRoute|saveQuantitySample|base44\.entities|setInterval\(|updateRecord|fetch\s*\(/i.test(pilot));
assert(!/toShare:|requestPermission\(.*write/.test(pilot));
assert(!pilot.includes('androidHealthAdapter.readActivities') && !pilot.includes('allowSameMinuteSource'));
assert(panel.includes('OFF by default') && panel.includes('Enable background uploads for NEW runs'));
assert(entry.indexOf("import './src/ingestion/background-sync-pilot';") >= 0);
assert(entry.indexOf("import './src/ingestion/background-sync-pilot';") < entry.indexOf("import 'expo-router/entry';"));
assert(activityScreen.includes('<BackgroundSyncPilotPanel provider={adapter.id}'));
assert.equal(session.split('await clearBackgroundSyncPilot();').length-1,3);
assert(!adapter.includes('allowSameMinuteSource: __DEV__'), 'Test-only fallback must no longer run in production adapter');
if(adapter.includes('allowSameMinuteSource')) assert(adapter.includes('allowSameMinuteSource: false'), 'Unsafe matching option may not be enabled');
assert.equal(pkg.main,'./index.js');
assert(app.android.permissions.includes('android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND'));
assert(app.plugins.some((x)=>Array.isArray(x)&&x[0]==='@kingstinct/react-native-healthkit'&&x[1].background===true));
console.log('PASS: guarded same-clock-minute Android start/end matching, no 15-second cap, full-minute queries, same-writer and ambiguity checks.');
console.log('PASS: background new-only, source-specific, <=1 per tick, existing receipt & foreground mark dedupe.');
console.log('PASS: separate opt-in, foreground OS permissions, fresh invite authorization, session/consent recheck, paused failure, no Health writes.');
console.log('PASS: global worker before Router, lifecycle cleanup in 3 paths, Android test-only match disabled in adapter.');
