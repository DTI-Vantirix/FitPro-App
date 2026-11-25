import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

const { parseHeartRate } = load('src/run/hr-parse.ts');
const b64 = (...bytes) => Buffer.from(bytes).toString('base64');

await test('8-bit heart rate (flag bit 0 clear)', () => {
  assert.equal(parseHeartRate(b64(0x00, 72)), 72);
  // sensor-contact and energy bits set, RR intervals following: still the second byte
  assert.equal(parseHeartRate(b64(0x16, 151, 0x10, 0x02, 0x40, 0x01)), 151);
});
await test('16-bit heart rate (flag bit 0 set), little-endian', () => {
  assert.equal(parseHeartRate(b64(0x01, 0xa0, 0x00)), 160);
});
await test('values no heart produces, and broken packets, are no reading', () => {
  assert.equal(parseHeartRate(b64(0x01, 0x2c, 0x01)), null); // 300
  assert.equal(parseHeartRate(b64(0x00, 0)), null);
  assert.equal(parseHeartRate(b64(0x00, 20)), null);
  assert.equal(parseHeartRate(b64(0x01, 0xa0)), null); // truncated 16-bit
  assert.equal(parseHeartRate(b64(0x00)), null);
  assert.equal(parseHeartRate(''), null);
  assert.equal(parseHeartRate('not base64 !!'), null);
  assert.equal(parseHeartRate(null), null);
});
done('Bluetooth heart-rate measurement parsing');
