import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve('.');
const rel = 'src/ingestion/background-sync-inspection.ts';
const raw = fs.readFileSync(path.join(root, rel), 'utf8');
const panel = fs.readFileSync(path.join(root,'src/ingestion/background-sync-pilot-panel.tsx'),'utf8');
for (const file of [rel,'src/ingestion/background-sync-pilot-panel.tsx']) {
  const text = fs.readFileSync(path.join(root,file),'utf8');
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(parsed.parseDiagnostics.length,0,`${file}: TypeScript parse errors`);
}
assert(panel.includes('Inspect recent Health Connect matching (read-only)'));
assert(panel.includes('inspectAndroidBackgroundSync(status.enabledAt)'));
assert(!raw.includes('submitHealthActivity('));
assert(!raw.includes('setItemAsync('));
assert(!raw.includes('requestPermission('));
assert(!raw.includes('console.log('));
assert(!raw.includes('getInviteStatus('));
assert(!raw.includes('submitHealthActivity('));
assert(raw.includes('strictAndroidBackgroundRun(s, distances, allSessions)'));
assert(raw.includes('minute(Date.parse(r.startTime)) === minute(start)'));

const transpiled = ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,
  target:ts.ScriptTarget.ES2020, esModuleInterop:true}}).outputText;
const start = new Date(); start.setHours(start.getHours()-1); start.setUTCSeconds(0,0);
const optIn = new Date(start.getTime()-60*60_000);
const session = { startTime:new Date(start.getTime()+2_000).toISOString(),
 endTime:new Date(start.getTime()+30*60_000+2_000).toISOString(), exerciseType:56,
 metadata:{id:'test-session-1',dataOrigin:'toolbox'}};
const distance = {startTime:new Date(start.getTime()+20_000).toISOString(),
 endTime:new Date(start.getTime()+30*60_000+40_000).toISOString(),
 distance:{inMeters:3000},metadata:{dataOrigin:'toolbox'}};
const runScenario = async (distanceRecord, expectReason) => {
  const module={exports:{}};
  const hc={SdkAvailabilityStatus:{SDK_AVAILABLE:1},getSdkStatus:async()=>1,
    initialize:async()=>true,
    getGrantedPermissions:async()=>[{accessType:'read',recordType:'ExerciseSession'},
      {accessType:'read',recordType:'Distance'}],
    readRecords:async(type)=>({records:type==='ExerciseSession'?[session]:[distanceRecord],pageToken:undefined})};
  const fakeRequire = (mod) => {
    if(mod==='react-native')return {Platform:{OS:'android'}};
    if(mod==='react-native-health-connect')return hc;
    if(mod==='./background-sync-safe')return {strictAndroidBackgroundRun:(s,d)=>
      d.length===1 && d[0].metadata.dataOrigin===s.metadata.dataOrigin &&
      Math.floor(Date.parse(d[0].startTime)/60000)===Math.floor(Date.parse(s.startTime)/60000) &&
      Math.floor(Date.parse(d[0].endTime)/60000)===Math.floor(Date.parse(s.endTime)/60000)
      ? {kind:'run'}:null};
    throw new Error(`Unexpected runtime import ${mod}`);
  };
  new Function('require','module','exports',transpiled)(fakeRequire,module,module.exports);
  const result=await module.exports.inspectAndroidBackgroundSync(optIn.toISOString());
  assert.equal(result.runningSessions,1);
  assert.equal(result.recentRuns[0].reason,expectReason);
};
await runScenario(distance,'MATCH_OK');
await runScenario({...distance,endTime:new Date(start.getTime()+31*60_000+30_000).toISOString()},'START_OR_END_MINUTE_MISMATCH');
console.log('PASS: diagnostic syntax, read-only UI wiring, simulated same-minute match and end-minute mismatch.');
