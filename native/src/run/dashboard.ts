/** The Today screen's numbers — pure. The runner's runs as the server holds them, joined
 * with the runs on this phone that have not uploaded yet, each counted once; and the
 * week's totals worked out the way the website's Home page does (web/src/pages/Home.jsx).
 */
import type { ServerRun } from './api';
import type { StoredRun } from './queue';

export type DashRunStatus = 'saved' | 'pending' | 'needs_attention' | 'local_only';
export type DashRun = {
  key: string;
  /** external_id of the copy kept on this phone, when there is one: it opens the full summary. */
  localId: string | null;
  routeName: string;
  distanceMi: number;
  durationSec: number;
  avgPaceSec: number | null;
  startedAt: string | null;
  status: DashRunStatus;
  /** False for a run too short to be saved to VantraRun: shown, never added to the totals. */
  counted: boolean;
};
export type WeekStats = {
  runs: number;
  distance: number;
  time: number;
  avgPaceSec: number | null;
  /** Distance against last week, in percent, as the website shows it. */
  deltaPct: number;
};

const time = (iso: string | null): number | null => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

function fromPhone(run: StoredRun): DashRun {
  const { summary } = run;
  return {
    key: `phone-${summary.externalId}`,
    localId: summary.externalId,
    routeName: summary.routeName,
    distanceMi: summary.distanceMi,
    durationSec: summary.durationSec,
    avgPaceSec: summary.avgPaceSec,
    startedAt: summary.startedAt,
    status: run.status === 'uploaded' ? 'saved' : run.status,
    counted: run.status !== 'local_only',
  };
}

/** One list, newest first. `server` is null when the server could not be asked: then the
 * phone's own runs are all there is. Otherwise the server is the record of what was saved,
 * and from the phone come only the runs it does not have yet. A run is the same run when
 * its external_id matches (the id made when the run started and sent with the upload), or
 * when the phone recorded the server's id for it. */
export function mergeRuns(server: ServerRun[] | null, stored: StoredRun[]): DashRun[] {
  const runs: DashRun[] = [];
  if (server === null) {
    runs.push(...stored.map(fromPhone));
  } else {
    const byExternalId = new Map(stored.map((run) => [run.summary.externalId, run]));
    const byServerId = new Map(stored.filter((run) => run.serverRunId).map((run) => [run.serverRunId as string, run]));
    const matched = new Set<string>();
    for (const run of server) {
      const local = (run.externalId ? byExternalId.get(run.externalId) : undefined) ?? byServerId.get(run.id) ?? null;
      if (local) matched.add(local.summary.externalId);
      runs.push({
        key: run.id,
        localId: local ? local.summary.externalId : null,
        routeName: run.routeName,
        distanceMi: run.distanceMi,
        durationSec: run.durationSec,
        avgPaceSec: run.avgPaceSec,
        startedAt: run.startedAt,
        status: 'saved',
        counted: true,
      });
    }
    // An uploaded run the server no longer lists (deleted on the website, or older than the
    // runs asked for) is not brought back from the phone's copy.
    runs.push(...stored.filter((run) => run.status !== 'uploaded' && !matched.has(run.summary.externalId)).map(fromPhone));
  }
  return runs
    .map((run, index) => ({ run, index, at: time(run.startedAt) }))
    .sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.index - b.index)
    .map((item) => item.run);
}

/** Monday 00:00 local time, the week the website's dashboard uses. */
export function startOfWeek(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Totals since Monday, and the distance compared with the week before. */
export function weekStats(runs: DashRun[], now: Date): WeekStats {
  const weekStart = startOfWeek(now);
  const lastStart = new Date(weekStart);
  lastStart.setDate(lastStart.getDate() - 7);
  const from = weekStart.getTime();
  const lastFrom = lastStart.getTime();
  let count = 0;
  let distance = 0;
  let seconds = 0;
  let lastDistance = 0;
  for (const run of runs) {
    const at = time(run.startedAt);
    if (!run.counted || at == null) continue;
    if (at >= from) {
      count += 1;
      distance += run.distanceMi;
      seconds += run.durationSec;
    } else if (at >= lastFrom) {
      lastDistance += run.distanceMi;
    }
  }
  return {
    runs: count,
    distance,
    time: seconds,
    avgPaceSec: distance > 0.1 ? seconds / distance : null,
    deltaPct: lastDistance > 0 ? Math.round(((distance - lastDistance) / lastDistance) * 100) : distance > 0 ? 100 : 0,
  };
}
