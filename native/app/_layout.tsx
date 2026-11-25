import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../src/auth/session';
import { AccessGateProvider } from '../src/access/access-gate';
import { RunAccountProvider } from '../src/run/use-run';
import { colors } from '../src/theme';

export default function RootLayout() {
  return (
    <SessionProvider>
      <AccessGateProvider>
        <RunAccountProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        animation: 'fade',
      }}>
        <Stack.Screen name="index" options={{ title: 'Sign in', headerShown: false }} />
        <Stack.Screen name="signup" options={{ title: 'Create account', headerShown: false }} />
        <Stack.Screen name="consent" options={{ title: 'Your data' }} />
        <Stack.Screen name="invite" options={{ title: 'Invite verification' }} />
        <Stack.Screen name="spike" options={{ title: 'Ingestion test' }} />
        <Stack.Screen name="activities" options={{ title: 'Import from health' }} />
        <Stack.Screen name="setup" options={{ title: 'Set your zones', headerBackVisible: false }} />
        <Stack.Screen name="home" options={{ title: 'FitPro', headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="run-start" options={{ title: 'Start a run' }} />
        <Stack.Screen name="run-live" options={{ title: 'Run', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="run-summary" options={{ title: 'Run summary', headerBackVisible: false, gestureEnabled: false }} />
        </Stack>
        </RunAccountProvider>
      </AccessGateProvider>
    </SessionProvider>
  );
}
