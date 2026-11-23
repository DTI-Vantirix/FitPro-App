import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../src/auth/session';
import { colors } from '../src/theme';

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        animation: 'fade',
      }}>
        <Stack.Screen name="index" options={{ title: 'Sign in', headerShown: false }} />
        <Stack.Screen name="spike" options={{ title: 'Ingestion test' }} />
      </Stack>
    </SessionProvider>
  );
}
