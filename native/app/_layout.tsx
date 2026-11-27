import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import Feather from '@expo/vector-icons/Feather';
import { SessionProvider } from '../src/auth/session';
import { AccessGateProvider } from '../src/access/access-gate';
import { RunAccountProvider } from '../src/run/use-run';
import { colors } from '../src/theme';
import { fontAssets, fonts } from '../src/typography';

// The splash stays up until the brand fonts (bundled in the app, never fetched) are ready.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ ...fontAssets, ...Feather.font });
  // A font that fails to load must never lock the runner out: carry on with the system font.
  const ready = fontsLoaded || fontError !== null;
  useEffect(() => { if (ready) void SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;

  return (
    <SessionProvider>
      <AccessGateProvider>
        <RunAccountProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.bodyStrong },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'fade',
      }}>
        <Stack.Screen name="index" options={{ title: 'Sign in' }} />
        <Stack.Screen name="signup" options={{ title: 'Create account' }} />
        <Stack.Screen name="consent" options={{ title: 'Your data' }} />
        <Stack.Screen name="invite" options={{ title: 'Invite' }} />
        <Stack.Screen name="setup" options={{ title: 'Set your zones' }} />
        {/* Today, Routes, Analytics and Settings, with the bottom tab bar. */}
        <Stack.Screen name="(tabs)" options={{ title: 'VantraRun' }} />
        {/* Full screen, no tab bar. The back swipe is off: it would fight dragging the map and its points. */}
        <Stack.Screen name="route-new" options={{ title: 'Draw a route', gestureEnabled: false }} />
        {/* Reached from Settings, Analytics and the zone picker of run-start. */}
        <Stack.Screen name="zones" options={{ title: 'Pace zones' }} />
        {/* Full screen, above the tabs: no tab bar while starting, running or reviewing a run. */}
        <Stack.Screen name="run-start" options={{ title: 'Start a run' }} />
        <Stack.Screen name="run-live" options={{ title: 'Run', gestureEnabled: false }} />
        <Stack.Screen name="run-summary" options={{ title: 'Run summary', gestureEnabled: false }} />
        {/* Developer screen, reached from Settings; keeps the system header for its back button. */}
        <Stack.Screen name="spike" options={{ title: 'Connection test', headerShown: true }} />
        </Stack>
        </RunAccountProvider>
      </AccessGateProvider>
    </SessionProvider>
  );
}
