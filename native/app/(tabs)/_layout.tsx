import React from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { TabBar } from '../../src/components/TabBar';
import { colors } from '../../src/theme';

/** The signed-in area. Each screen keeps its own access gate; the bar itself is in
 * src/components/TabBar.tsx, which also lists the tabs. A screen registered here but not
 * listed in TABS (Activities, the health import) has no button on the bar and is opened by
 * its address: router.push('/activities'). */
export default function TabsLayout() {
  return <Tabs tabBar={(props) => <TabBar {...props} />}
    screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}>
    <Tabs.Screen name="home" options={{ title: 'Today' }} />
    <Tabs.Screen name="feed" options={{ title: 'Feed' }} />
    <Tabs.Screen name="routes" options={{ title: 'Routes' }} />
    <Tabs.Screen name="analytics" options={{ title: 'Analytics' }} />
    <Tabs.Screen name="activities" options={{ title: 'Import runs' }} />
  </Tabs>;
}
