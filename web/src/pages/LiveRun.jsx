import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Dumbbell, Pause, Play, Square, TriangleAlert } from 'lucide-react';
import { api } from '@/api/client';
import MapView from '@/components/MapView';
import PaceReadout from '@/components/run/PaceReadout';
import ZonePicker from '@/components/run/ZonePicker';
import SplitsList from '@/components/run/SplitsList';
import LegsList from '@/components/run/LegsList';
import RunSummary from '@/components/run/RunSummary';
import HeartRateCard from '@/components/run/HeartRateCard';
import useHeartRate from '@/hooks/useHeartRate';
import { loadProfile } from '@/lib/profile';
import { haversineMiles, pathMiles, zoneStatus } from '@/lib/geo';
import { formatDuration, formatPace } from '@/lib/format';
import { sortZones } from '@/lib/zones';
import { cn } from '@/lib/utils';

export default function LiveRun() {
  const [params] = useSearchParams();
  const routeParam = params.get('route');

  const [zones, setZones] = useState([]);
  const [routeList, setRouteList] = useState([]);
  const [profile, setProfile] = useState(null);
  const [route, setRoute] = useState(null);
  const [zoneId, setZoneId] = useState('');

  const [status, setStatus] = useState('idle');
  const [mapCenter, setMapCenter] = useState(null);
  const [position, setPosition] = useState(null);
  const [trail, setTrail] = useState([]);
  const [distance, setDistance] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [splits, setSplits] = useState([]);
  const [geoError, setGeoError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [atGym, setAtGym] = useState(false);
  const [legs, setLegs] = useState([]);
  const heart = useHeartRate();

  const lastPt = useRef(null);
  const gymDone = useRef(false);
  const runningRef = useRef(false);
  const elapsedRef = useRef(0);
  const distanceRef = useRef(0);
  const inZoneRef = useRef(0);
  const paceRef = useRef(0);
  const zoneRef = useRef(null);
  const splitTimeRef = useRef(0);
  const splitsRef = useRef([]);
  const startedAt = useRef(null);
  const watchId = useRef(null);
  const legsRef = useRef([]);
  const legStartDist = useRef(0);
  const legStartElapsed = useRef(0);
  const legFromRef = useRef('Start');

  const gymLabel = route?.gym_stop?.trim() || 'Gym';

  // Closes the leg in progress — start to gym, then gym to finish.
  const closeLeg = (toLabel) => {
    const legDist = distanceRef.current - legStartDist.current;
    const legTime = elapsedRef.current - legStartElapsed.current;
    if (legDist <= 0.005 && legTime <= 0) return legsRef.current;
    legsRef.current = [
      ...legsRef.current,
      {
        index: legsRef.current.length + 1,
        from: legFromRef.current,
        to: toLabel,
        distance_mi: Number(legDist.toFixed(2)),
        duration_sec: legTime,
        avg_pace_sec: legDist > 0.01 ? Math.round(legTime / legDist) : 0,
      },
    ];
    setLegs(legsRef.current);
    return legsRef.current;
  };

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.entities.PaceZone.list({ sort: 'fast_sec', limit: 20 }),
      api.entities.Route.list({ sort: '-created_date', limit: 30 }),
      loadProfile(),
    ])
      .then(([zonePage, routePage, userProfile]) => {
        if (!alive) return;
        setZones(sortZones(zonePage.items || []));
        setRouteList(routePage.items || []);
        setProfile(userProfile);
      })
      .catch((err) => alive && setGeoError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!routeParam) {
      setRoute(null);
      return;
    }
    let alive = true;
    api.entities.Route.get(routeParam)
      .then((r) => alive && setRoute(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [routeParam]);

  // The route's own zone wins as soon as the route has loaded.
  useEffect(() => {
    if (!zones.length || !route?.target_zone_id) return;
    const preferred = zones.find((z) => z.id === route.target_zone_id);
    if (preferred) setZoneId(preferred.id);
  }, [route?.id, zones]);

  // Otherwise start on Zone 2.
  useEffect(() => {
    if (zoneId || !zones.length) return;
    const fallback = zones.find((z) => Number(z.zone_number) === 2) || zones[0];
    setZoneId(fallback.id);
  }, [zones, zoneId]);

  const zone = zones.find((z) => z.id === zoneId) || null;
  useEffect(() => {
    zoneRef.current = zone;
  }, [zone]);

  const gymPoint = route?.gym_point || null;
  useEffect(() => {
    if (!gymPoint || !position || status !== 'running' || gymDone.current) return;
    if (distanceRef.current < 0.2) return;
    if (haversineMiles(position, gymPoint) <= 0.05) {
      gymDone.current = true;
      runningRef.current = false;
      closeLeg(gymLabel);
      setStatus('paused');
      setAtGym(true);
    }
  }, [gymPoint, position, status]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError('This device cannot share a GPS location.');
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPosition(p);
        setMapCenter((c) => c || [p.lat, p.lng]);
        setGeoError(null);
        if (!runningRef.current) {
          lastPt.current = p;
          return;
        }
        if (pos.coords.accuracy && pos.coords.accuracy > 45) return;
        const prev = lastPt.current;
        if (prev) {
          const d = haversineMiles(prev, p);
          if (d >= 0.002 && d < 0.4) {
            distanceRef.current += d;
            setDistance(distanceRef.current);
            const nextMile = splitsRef.current.length + 1;
            if (distanceRef.current >= nextMile) {
              const splitPace = elapsedRef.current - splitTimeRef.current;
              splitsRef.current = [...splitsRef.current, { mile: nextMile, pace_sec: Math.round(splitPace) }];
              setSplits(splitsRef.current);
              splitTimeRef.current = elapsedRef.current;
            }
          }
        }
        lastPt.current = p;
        setTrail((t) => {
          const last = t[t.length - 1];
          if (last && haversineMiles(last, p) < 0.004) return t;
          return [...t, { ...p, t: Date.now() }];
        });
      },
      (err) =>
        setGeoError(
          err.code === 1
            ? 'Location access is blocked. Allow location for this app, then try again.'
            : 'Waiting for a GPS signal — step outside for a clearer fix.'
        ),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, []);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    if (status !== 'running') return;
    const id = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      const z = zoneRef.current;
      if (z && paceRef.current >= z.fast_sec && paceRef.current <= z.slow_sec) inZoneRef.current += 1;
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  const avgPace = distance > 0.01 ? elapsed / distance : 0;

  const currentPace = useMemo(() => {
    if (trail.length < 2) return avgPace;
    const cutoff = Date.now() - 30000;
    const recent = trail.filter((p) => p.t >= cutoff);
    if (recent.length < 2) return avgPace;
    const dist = pathMiles(recent);
    const dt = (recent[recent.length - 1].t - recent[0].t) / 1000;
    if (dt < 6 || dist < 0.01) return avgPace;
    return dt / dist;
  }, [trail, avgPace]);

  useEffect(() => {
    paceRef.current = currentPace || 0;
  }, [currentPace]);

  const paceStatus = zoneStatus(zone, currentPace || avgPace);

  const start = () => {
    if (!position) {
      setGeoError('Getting your first GPS fix — this usually takes a few seconds outdoors.');
      return;
    }
    lastPt.current = position;
    startedAt.current = new Date().toISOString();
    runningRef.current = true;
    setElapsed(0);
    setDistance(0);
    setSplits([]);
    splitsRef.current = [];
    splitTimeRef.current = 0;
    elapsedRef.current = 0;
    distanceRef.current = 0;
    inZoneRef.current = 0;
    gymDone.current = false;
    legsRef.current = [];
    legStartDist.current = 0;
    legStartElapsed.current = 0;
    legFromRef.current = 'Start';
    setLegs([]);
    heart.resetStats();
    setAtGym(false);
    setStatus('running');
  };

  const pause = () => {
    runningRef.current = false;
    setStatus('paused');
  };

  const resume = () => {
    lastPt.current = position;
    runningRef.current = true;
    if (gymDone.current) {
      legStartDist.current = distanceRef.current;
      legStartElapsed.current = elapsedRef.current;
      legFromRef.current = gymLabel;
    }
    setStatus('running');
    setAtGym(false);
  };

  const finish = async () => {
    runningRef.current = false;
    setSaving(true);
    const allLegs = closeLeg('Finish');
    const payload = {
      route_id: route?.id || '',
      route_name: route?.name || 'Free run',
      distance_mi: Number(distance.toFixed(2)),
      duration_sec: elapsed,
      avg_pace_sec: Math.round(avgPace) || 0,
      started_at: startedAt.current || new Date().toISOString(),
      target_zone_name: zone?.name || '',
      target_fast_sec: zone?.fast_sec || 0,
      target_slow_sec: zone?.slow_sec || 0,
      in_zone_pct: elapsed ? Math.round((inZoneRef.current / elapsed) * 100) : 0,
      splits,
      points: trail.map(({ lat, lng }) => ({ lat, lng })),
      legs: allLegs,
      ...(gymPoint ? { gym_point: gymPoint, gym_name: gymLabel } : {}),
      ...(heart.stats.avg
        ? { avg_hr: heart.stats.avg, max_hr: heart.stats.max, hr_device: heart.deviceName }
        : {}),
    };
    const created = await api.entities.Run.create(payload);
    setSaved(created);
    setSaving(false);
    setStatus('saved');
  };

  if (status === 'saved' && saved) {
    return <RunSummary run={saved} />;
  }

  const live = status === 'running' || status === 'paused';

  const legDist = distance - legStartDist.current;
  const legTime = Math.max(0, elapsed - legStartElapsed.current);
  const activeLeg =
    status === 'running'
      ? {
          from: legFromRef.current,
          to: gymDone.current ? 'Finish' : gymLabel,
          distance_mi: Number(legDist.toFixed(2)),
          duration_sec: legTime,
          avg_pace_sec: legDist > 0.01 ? Math.round(legTime / legDist) : 0,
        }
      : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <p className="eyebrow">{live ? 'Live run' : 'Ready to run'}</p>
            <h1 className="font-heading text-lg font-bold leading-tight">{route?.name || 'Free run'}</h1>
          </div>
        </div>
        {live && (
          <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                status === 'running' ? 'animate-pulse bg-primary' : 'bg-muted-foreground'
              )}
            />
            <span className="num text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {status === 'running' ? 'recording' : 'paused'}
            </span>
          </span>
        )}
      </div>

      {geoError && (
        <p className="flex items-start gap-2 rounded-xl border border-[#FFC24B]/30 bg-[#FFC24B]/10 px-3 py-2.5 text-xs leading-relaxed text-[#FFD27D]">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {geoError}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-border">
        <MapView
          path={route?.path?.length ? route.path : route?.points || []}
          points={route?.points || []}
          gymPoint={gymPoint}
          trail={trail}
          position={position}
          follow={status === 'running'}
          fitKey={route?.id || 'live'}
          initialCenter={mapCenter || undefined}
          initialZoom={15}
          className="h-[38vh] min-h-[240px] w-full"
        />
      </div>

      <div className="panel space-y-5 p-5">
        <PaceReadout pace={currentPace || avgPace} zone={zone} status={paceStatus} />

        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-border">
          {[
            { label: 'Distance', value: Number(distance).toFixed(2), unit: 'mi' },
            { label: 'Time', value: formatDuration(elapsed), unit: 'mm:ss' },
            { label: 'Avg pace', value: formatPace(avgPace), unit: '/mi' },
          ].map((s) => (
            <div key={s.label} className="bg-card px-3 py-3">
              <p className="eyebrow text-[9px]">{s.label}</p>
              <p className="num mt-1 text-lg leading-none">{s.value}</p>
              <p className="num mt-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{s.unit}</p>
            </div>
          ))}
        </div>

        <HeartRateCard heart={heart} hrMax={profile?.hr_max || 0} zones={zones} />

        {!live ? (
          <>
            {routeList.length > 0 && (
              <div>
                <p className="eyebrow mb-2">Route</p>
                <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
                  <Link
                    to="/run"
                    className={cn(
                      'shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition-colors',
                      !route ? 'border-primary/60 bg-primary/10' : 'border-border text-muted-foreground'
                    )}
                  >
                    Free run
                  </Link>
                  {routeList.map((r) => (
                    <Link
                      key={r.id}
                      to={`/run?route=${r.id}`}
                      className={cn(
                        'shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition-colors',
                        route?.id === r.id
                          ? 'border-primary/60 bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {r.name} · {Number(r.distance_mi || 0).toFixed(1)} mi
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <ZonePicker zones={zones} value={zoneId} onChange={setZoneId} />

            {!zones.length && (
              <Link to="/zones" className="block rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                You have no pace zones yet — add your age, height and weight to build the five zones, then you get
                live pace feedback.
              </Link>
            )}

            <button
              type="button"
              onClick={start}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 font-heading text-base font-semibold text-primary-foreground transition hover:brightness-95 active:scale-[0.99]"
            >
              <Play className="h-4 w-4" strokeWidth={2.5} /> Start run
            </button>
          </>
        ) : (
          <>
            {atGym && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <p className="flex items-center gap-2 font-heading text-sm font-bold text-primary">
                  <Dumbbell className="h-4 w-4" /> Gym stop reached
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Your run paused automatically. Log the session, then pick the run back up.
                </p>
                <div className="mt-3 flex gap-2">
                  <Link
                    to="/workouts"
                    className="flex-1 rounded-full border border-border py-2.5 text-center font-heading text-xs font-medium transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    Log workout
                  </Link>
                  <button
                    type="button"
                    onClick={resume}
                    className="flex-1 rounded-full bg-primary py-2.5 font-heading text-xs font-semibold text-primary-foreground transition hover:brightness-95"
                  >
                    Resume run
                  </button>
                </div>
              </div>
            )}
            <ZonePicker zones={zones} value={zoneId} onChange={setZoneId} label="Target zone" />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={status === 'running' ? pause : resume}
                className="flex flex-1 items-center justify-center gap-2 rounded-full border border-border py-3.5 font-heading text-sm font-semibold transition-colors hover:border-primary/40 hover:text-primary"
              >
                {status === 'running' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {status === 'running' ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                onClick={finish}
                disabled={saving || distance < 0.01}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
              >
                <Square className="h-3.5 w-3.5" strokeWidth={2.5} /> {saving ? 'Saving…' : 'Finish'}
              </button>
            </div>
            {gymPoint && (
              <div>
                <p className="eyebrow mb-2">Legs</p>
                <LegsList legs={legs} active={activeLeg} />
              </div>
            )}
            <div>
              <p className="eyebrow mb-2">Splits</p>
              <SplitsList splits={splits} limit={4} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}