/** Plays a cue three ways: spoken, a vibration, and a local notification.
 * The notification is what a paired watch mirrors, so a runner whose phone is in a
 * pocket still sees "Heart rate above zone" on the wrist.
 */
import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import type { Cue } from '../cues';

const CHANNEL = 'run-cues';
let prepared = false;
let notificationsAllowed = false;

/** Asks for notification permission and sets up the Android channel. Safe to call more than once.
 * A refusal only loses the notification copy; speech and vibration still work. */
export async function prepareAlerts(): Promise<{ notifications: boolean }> {
  if (!prepared) {
    prepared = true;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Run cues',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250],
        sound: null,
      }).catch(() => {});
    }
  }
  try {
    const current = await Notifications.getPermissionsAsync();
    notificationsAllowed = current.granted || (current.canAskAgain ? (await Notifications.requestPermissionsAsync()).granted : false);
  } catch {
    notificationsAllowed = false;
  }
  return { notifications: notificationsAllowed };
}

const TITLES: Record<Cue['metric'], string> = { pace: 'Pace', hr: 'Heart rate', route: 'Route', turn: 'Next turn' };

export function playCue(cue: Cue): void {
  try {
    Vibration.vibrate(cue.kind === 'returned' || cue.kind === 'info' ? 250 : [0, 250, 150, 250]);
  } catch { /* no vibrator */ }
  try {
    // A separate system-managed audio session: speech ducks the runner's music instead of stopping it.
    Speech.speak(cue.text, { language: 'en-US', rate: 1.0, useApplicationAudioSession: false });
  } catch { /* speech engine unavailable */ }
  if (notificationsAllowed) {
    void Notifications.scheduleNotificationAsync({
      content: { title: TITLES[cue.metric], body: cue.text, sound: false, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    }).catch(() => {});
  }
}

export function stopSpeaking(): void {
  void Speech.stop().catch(() => {});
}

/** Removes cue notifications left on the lock screen once the run is over. */
export async function clearCueNotifications(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync().catch(() => {});
}
