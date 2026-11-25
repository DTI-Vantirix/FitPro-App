/** Hooks crash reporting into the app. Imported once, from index.js. */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { installErrorReporting } from './error-reports';

// The same key the session uses (src/auth/session.tsx). Read here so a crash before
// React has mounted can still be reported for a signed-in person.
const TOKEN_KEY = 'fitpro.native.6af5fd196ba44438a305cc72.user.access_token';

type WithErrorUtils = { ErrorUtils?: Parameters<typeof installErrorReporting>[0]['errorUtils'] };

installErrorReporting({
  errorUtils: (globalThis as WithErrorUtils).ErrorUtils,
  getToken: () => SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
  meta: () => ({ platform: Platform.OS, appVersion: Constants.expoConfig?.version ?? null }),
});
