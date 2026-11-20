import { useCallback, useRef, useState } from 'react';
import { connectHeartRate, heartRateSupported } from '@/lib/heartRate';

export default function useHeartRate() {
  const [status, setStatus] = useState('idle');
  const [bpm, setBpm] = useState(0);
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ avg: 0, max: 0, seconds: 0 });

  const link = useRef(null);
  const tally = useRef({ sum: 0, count: 0, max: 0 });

  const resetStats = useCallback(() => {
    tally.current = { sum: 0, count: 0, max: 0 };
    setStats({ avg: 0, max: 0, seconds: 0 });
  }, []);

  const connect = useCallback(async () => {
    if (!heartRateSupported()) {
      setStatus('error');
      setError('This browser cannot reach Bluetooth monitors. Use Chrome on Android or a desktop browser.');
      return;
    }
    setStatus('connecting');
    setError(null);
    try {
      link.current = await connectHeartRate(
        (value) => {
          setBpm(value);
          tally.current = {
            sum: tally.current.sum + value,
            count: tally.current.count + 1,
            max: Math.max(tally.current.max, value),
          };
          setStats({
            avg: Math.round(tally.current.sum / tally.current.count),
            max: tally.current.max,
            seconds: tally.current.count,
          });
        },
        () => {
          link.current = null;
          setStatus('idle');
          setBpm(0);
          setDeviceName('');
        }
      );
      setDeviceName(link.current.name);
      setStatus('connected');
    } catch (err) {
      const cancelled = err?.name === 'NotFoundError';
      setStatus(cancelled ? 'idle' : 'error');
      if (!cancelled) setError(err.message);
    }
  }, []);

  const disconnect = useCallback(() => {
    try {
      link.current?.disconnect();
    } catch {
      // the monitor is already gone
    }
    link.current = null;
    setStatus('idle');
    setBpm(0);
    setDeviceName('');
  }, []);

  return {
    supported: heartRateSupported(),
    status,
    bpm,
    deviceName,
    error,
    stats,
    connect,
    disconnect,
    resetStats,
  };
}