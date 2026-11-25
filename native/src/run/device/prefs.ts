/** Remembers which cues the runner muted, so the choice carries to the next run. */
import * as SecureStore from 'expo-secure-store';
import type { Mute } from '../engine';

const KEY = 'fitpro.native.6af5fd196ba44438a305cc72.run_cue_mute.v1';

export async function loadMute(): Promise<Mute> {
  try {
    const saved = JSON.parse((await SecureStore.getItemAsync(KEY)) ?? 'null') as Partial<Mute> | null;
    return { pace: saved?.pace === true, hr: saved?.hr === true };
  } catch {
    return { pace: false, hr: false };
  }
}

export async function saveMute(mute: Mute): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ pace: mute.pace, hr: mute.hr })).catch(() => {});
}
