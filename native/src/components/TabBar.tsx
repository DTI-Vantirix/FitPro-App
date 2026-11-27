/** Bottom tab bar of the signed-in area, matching the website's: Ink bar, Line top border,
 * Steel outline icons, the active tab in Volt with a 2 px underline, and a raised round
 * Volt button in the centre that starts a run.
 *
 * To add a tab: create `app/(tabs)/<name>.tsx` and add one line to TABS. Tabs are split
 * evenly either side of the centre button.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { fonts } from '../typography';
import type { IconName } from './Ui';

export const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: 'home', label: 'Today', icon: 'home' },
  { name: 'activities', label: 'Activities', icon: 'activity' },
  { name: 'settings', label: 'Settings', icon: 'settings' },
];

export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const split = Math.ceil(TABS.length / 2);

  const renderTab = (tab: (typeof TABS)[number]) => {
    const index = state.routes.findIndex((route) => route.name === tab.name);
    if (index < 0) return null;
    const route = state.routes[index];
    const focused = state.index === index;
    const tint = focused ? colors.accent : colors.subtle;
    const onPress = () => {
      const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigateToTab(route.key);
    };
    return <Pressable key={tab.name} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected: focused }}
      onPress={onPress} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <Feather name={tab.icon} size={21} color={tint} />
      <Text style={[styles.label, { color: tint }]} numberOfLines={1}>{tab.label}</Text>
      <View style={[styles.underline, focused && styles.underlineActive]} />
    </Pressable>;
  };

  return <View style={[styles.bar, { paddingBottom: insets.bottom + 6 }]}>
    <View style={styles.side}>{TABS.slice(0, split).map(renderTab)}</View>
    {/* run-start sends a runner with a run in progress straight to the live screen. */}
    <Pressable accessibilityRole="button" accessibilityLabel="Start a run" onPress={() => router.push('/run-start')}
      style={({ pressed }) => [styles.start, pressed && styles.startPressed]}>
      <Feather name="play" size={22} color={colors.accentText} style={styles.play} />
    </Pressable>
    <View style={styles.side}>{TABS.slice(split).map(renderTab)}</View>
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'flex-end', backgroundColor: colors.background, borderTopWidth: 1,
    borderTopColor: colors.panelBorder, paddingTop: 8, paddingHorizontal: 8 },
  side: { flex: 1, flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center', gap: 4, paddingTop: 6, minHeight: 48 },
  pressed: { opacity: 0.6 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 10, lineHeight: 14 },
  underline: { width: 16, height: 2, borderRadius: 1, backgroundColor: 'transparent' },
  underlineActive: { backgroundColor: colors.accent },
  // The Ink border is the ring that lifts the button off the bar's top line.
  start: { width: 64, height: 64, borderRadius: 32, marginTop: -28, marginHorizontal: 6, backgroundColor: colors.accent,
    borderWidth: 4, borderColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  startPressed: { transform: [{ scale: 0.95 }] },
  play: { marginLeft: 3 },
});
