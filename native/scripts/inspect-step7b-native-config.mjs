import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')).expo;
const health = (app.plugins ?? []).find(x => Array.isArray(x) && x[0] === '@kingstinct/react-native-healthkit');
console.log('Step 7B native configuration (read-only check):');
console.log('Expo background scheduler package:', pkg.dependencies?.['expo-background-task'] ? 'declared' : 'NOT INSTALLED');
console.log('Expo task manager package:', pkg.dependencies?.['expo-task-manager'] ? 'declared' : 'NOT INSTALLED');
console.log('iOS HealthKit plugin background delivery:', health?.[1]?.background === true ? 'declared' : 'NOT ENABLED');
const requested = app.android?.permissions ?? [];
console.log('Android Health Connect background permission in app.json:',
  requested.some(p => String(p).includes('READ_HEALTH_DATA_IN_BACKGROUND')) ? 'declared' : 'NOT DECLARED HERE');
console.log('Note: configuration presence does not prove OS permission grants or native entitlement approval.');
console.log('Step 7B.1 does NOT add missing packages/permissions; app remains foreground-only.');
