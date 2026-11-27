import React from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { TabBar } from '../../src/components/TabBar';
import { colors } from '../../src/theme';

/** The signed-in area. Each screen keeps its own access gate; the bar itself is in
 * src/components/TabBar.tsx, which also lists the tabs. */
export default function TabsLayout() {
  return <Tabs tabBar={(props) => <TabBar {...props} />}
    screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}>
    <Tabs.Screen name="home" options={{ title: 'Today' }} />
    <Tabs.Screen name="routes" options={{ title: 'Routes' }} />
    <Tabs.Screen name="activities" options={{ title: 'Activities' }} />
    <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
  </Tabs>;
}
