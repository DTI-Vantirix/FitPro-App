/** Live heart rate over Bluetooth: any strap or watch that offers the standard
 * Heart Rate service (chest straps, Garmin watches in broadcast mode).
 * An Apple Watch does not offer it; that arrives with the watch companion (Stage 2).
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device, type Subscription } from 'react-native-ble-plx';
import { HEART_RATE_MEASUREMENT, HEART_RATE_SERVICE, parseHeartRate } from '../hr-parse';

export type HrMonitorStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'lost' | 'unavailable';
export type FoundSensor = { id: string; name: string };

let manager: BleManager | null = null;
function ble(): BleManager {
  // Created on first use: constructing it is what triggers the iOS Bluetooth prompt.
  if (!manager) manager = new BleManager();
  return manager;
}

async function androidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) < 31) {
    const fine = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return fine === PermissionsAndroid.RESULTS.GRANTED;
  }
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ]);
  return Object.values(result).every((value) => value === PermissionsAndroid.RESULTS.GRANTED);
}

async function poweredOn(): Promise<boolean> {
  const adapter = ble();
  if ((await adapter.state()) === State.PoweredOn) return true;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => { subscription.remove(); resolve(false); }, 4000);
    const subscription = adapter.onStateChange((state) => {
      if (state === State.PoweredOn) { clearTimeout(timer); subscription.remove(); resolve(true); }
    }, true);
  });
}

export function createHeartRateMonitor(onSample: (bpm: number, device: string) => void) {
  let status: HrMonitorStatus = 'idle';
  let device: Device | null = null;
  let wantedId: string | null = null;
  let monitor: Subscription | null = null;
  let disconnect: Subscription | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: HrMonitorStatus) => { status = next; for (const listener of listeners) listener(); };

  async function attach(id: string): Promise<void> {
    set('connecting');
    const connected = await ble().connectToDevice(id, { timeout: 10000 });
    await connected.discoverAllServicesAndCharacteristics();
    device = connected;
    const name = connected.name || connected.localName || 'Heart-rate sensor';
    monitor?.remove();
    monitor = connected.monitorCharacteristicForService(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, (error, characteristic) => {
      if (error) return;
      const bpm = parseHeartRate(characteristic?.value);
      if (bpm != null) onSample(bpm, name);
    });
    disconnect?.remove();
    disconnect = connected.onDisconnected(() => {
      if (wantedId !== id) return;
      set('lost');
      scheduleReconnect(id);
    });
    set('connected');
  }

  // A strap that slips or goes out of range comes back on its own; the run does not wait for it.
  function scheduleReconnect(id: string) {
    if (retry) clearTimeout(retry);
    retry = setTimeout(() => {
      if (wantedId !== id) return;
      attach(id).catch(() => { if (wantedId === id) { set('lost'); scheduleReconnect(id); } });
    }, 5000);
  }

  return {
    status: (): HrMonitorStatus => status,
    deviceName: (): string | null => device?.name || device?.localName || null,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    /** Looks for sensors for up to 15 s. Resolves with a function that stops the scan early. */
    async scan(onFound: (sensor: FoundSensor) => void): Promise<() => void> {
      if (!(await androidPermissions())) { set('unavailable'); throw new Error('Bluetooth permission is needed to find a heart-rate sensor.'); }
      if (!(await poweredOn())) { set('unavailable'); throw new Error('Turn Bluetooth on to connect a heart-rate sensor.'); }
      const seen = new Set<string>();
      const previous = status;
      set('scanning');
      const stop = () => {
        clearTimeout(timer);
        void ble().stopDeviceScan();
        if (status === 'scanning') set(previous === 'connected' ? 'connected' : 'idle');
      };
      const timer = setTimeout(stop, 15000);
      void ble().startDeviceScan([HEART_RATE_SERVICE], null, (error, found) => {
        if (error || !found || seen.has(found.id)) return;
        seen.add(found.id);
        onFound({ id: found.id, name: found.name || found.localName || 'Heart-rate sensor' });
      });
      return stop;
    },

    async connect(id: string): Promise<void> {
      void ble().stopDeviceScan();
      wantedId = id;
      try {
        await attach(id);
      } catch (cause) {
        wantedId = null;
        set('idle');
        throw new Error(`Could not connect to the sensor: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },

    async disconnect(): Promise<void> {
      const current = device;
      wantedId = null;
      if (retry) clearTimeout(retry);
      monitor?.remove();
      disconnect?.remove();
      monitor = null;
      disconnect = null;
      device = null;
      set('idle');
      if (current) await ble().cancelDeviceConnection(current.id).catch(() => {});
    },
  };
}

export type HeartRateMonitor = ReturnType<typeof createHeartRateMonitor>;
