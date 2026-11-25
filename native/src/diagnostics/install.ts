/** Hooks crash reporting into the app. Imported once, from index.js. */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { installErrorReporting, type ErrorReport, type PendingStore } from './error-reports';

// The same key the session uses (src/auth/session.tsx). Read here so a crash before
// React has mounted can still be reported for a signed-in person.
const TOKEN_KEY = 'fitpro.native.6af5fd196ba44438a305cc72.user.access_token';

// One report survives a crash in a small file, written synchronously, and is sent on the next launch.
const crashFile = () => new File(Paths.document, 'pending-crash-report.json');
const pending: PendingStore = {
  save(report) {
    const file = crashFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(report));
  },
  take() {
    const file = crashFile();
    if (!file.exists) return null;
    try { return JSON.parse(file.textSync()) as ErrorReport; } catch { file.delete(); return null; }
  },
  clear() {
    const file = crashFile();
    if (file.exists) file.delete();
  },
};

type WithErrorUtils = { ErrorUtils?: Parameters<typeof installErrorReporting>[0]['errorUtils'] };

void installErrorReporting({
  pending,
  errorUtils: (globalThis as WithErrorUtils).ErrorUtils,
  getToken: () => SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
  meta: () => ({ platform: Platform.OS, appVersion: Constants.expoConfig?.version ?? null }),
});
