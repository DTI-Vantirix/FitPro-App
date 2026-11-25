/** Decodes a Bluetooth Heart Rate Measurement (characteristic 0x2A37) — pure.
 * Chest straps and Garmin watches in broadcast mode both send this standard packet:
 * byte 0 is flags; bit 0 says whether the rate that follows is 8-bit or 16-bit
 * little-endian. Anything outside 30–240 bpm is treated as no reading.
 */
export const HEART_RATE_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
export const HEART_RATE_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64(text: string): number[] | null {
  const clean = text.replace(/=+$/, '');
  if (!clean || /[^A-Za-z0-9+/]/.test(clean)) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

export function parseHeartRate(base64: string | null | undefined): number | null {
  if (typeof base64 !== 'string') return null;
  const bytes = decodeBase64(base64);
  if (!bytes || bytes.length < 2) return null;
  const wide = (bytes[0] & 0x01) === 0x01;
  if (wide && bytes.length < 3) return null;
  const bpm = wide ? bytes[1] | (bytes[2] << 8) : bytes[1];
  return bpm >= 30 && bpm <= 240 ? bpm : null;
}
