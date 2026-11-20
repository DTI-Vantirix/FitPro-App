const HR_SERVICE = 'heart_rate';
const HR_MEASUREMENT = 'heart_rate_measurement';

export function heartRateSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
}

function readBpm(view) {
  const flags = view.getUint8(0);
  return (flags & 0x01) === 1 ? view.getUint16(1, true) : view.getUint8(1);
}

/**
 * Opens a Bluetooth heart-rate monitor — a chest strap, or a watch in
 * Broadcast Heart Rate mode — and streams bpm until it disconnects.
 */
export async function connectHeartRate(onBpm, onLost) {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [HR_SERVICE] }],
    optionalServices: [HR_SERVICE],
  });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(HR_SERVICE);
  const characteristic = await service.getCharacteristic(HR_MEASUREMENT);

  const handle = (event) => {
    const bpm = readBpm(event.target.value);
    if (bpm > 0) onBpm(bpm);
  };

  characteristic.addEventListener('characteristicvaluechanged', handle);
  await characteristic.startNotifications();
  device.addEventListener('gattserverdisconnected', onLost);

  return {
    name: device.name || 'Heart-rate monitor',
    disconnect: () => {
      characteristic.removeEventListener('characteristicvaluechanged', handle);
      if (device.gatt?.connected) device.gatt.disconnect();
    },
  };
}