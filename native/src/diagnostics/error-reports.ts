/** Crash reports, sent to the FitPro API and nowhere else (POST /api/client-errors).
 * There is no third-party monitoring SDK in this app. A report is a message, a stack
 * trace, the platform and the app version: no location, no health data, no token.
 * Reports are only sent for a signed-in person, and never block or crash the app.
 */
import { API_URL } from '../config';

export type ErrorReport = { message: string; stack?: string; context?: string; platform: string; app_version?: string };
export type ReportMeta = { platform: string; appVersion?: string | null; context?: string; fatal?: boolean };

const cut = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);
/** Anything shaped like a sign-in token is removed before a report leaves the phone. */
const scrub = (value: string) => value
  .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [removed]')
  .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, '[removed]');

export function buildErrorReport(error: unknown, meta: ReportMeta): ErrorReport {
  const isError = error instanceof Error;
  const raw = isError ? error.message : typeof error === 'string' ? error : (() => {
    try { return JSON.stringify(error) ?? String(error); } catch { return String(error); }
  })();
  const name = isError && error.name && error.name !== 'Error' ? `${error.name}: ` : '';
  const stack = isError && typeof error.stack === 'string' ? error.stack : '';
  const context = [meta.fatal ? 'fatal' : '', meta.context ?? ''].filter(Boolean).join(' · ');
  return {
    message: cut(scrub(`${name}${raw || 'Unknown error'}`), 500),
    ...(stack ? { stack: cut(scrub(stack), 4000) } : {}),
    ...(context ? { context: cut(context, 200) } : {}),
    platform: cut(meta.platform || 'app', 20),
    ...(meta.appVersion ? { app_version: cut(meta.appVersion, 40) } : {}),
  };
}

/** Sends one report. Resolves false when it could not be sent; never throws. */
export async function sendErrorReport(token: string | null, report: ErrorReport, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!token || !API_URL) return false;
  try {
    const response = await fetcher(`${API_URL}/api/client-errors`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(report),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** At most this many reports per app launch, so a crash loop cannot flood the server. */
export const MAX_REPORTS_PER_LAUNCH = 5;

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler(): GlobalHandler; setGlobalHandler(handler: GlobalHandler): void };

/** Wraps the app's global error handler. The original handler always still runs. */
export function installErrorReporting(deps: {
  errorUtils: ErrorUtilsLike | undefined;
  getToken: () => Promise<string | null>;
  meta: () => { platform: string; appVersion?: string | null };
  fetcher?: typeof fetch;
}): void {
  const utils = deps.errorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  let sent = 0;
  utils.setGlobalHandler((error, isFatal) => {
    try {
      if (sent < MAX_REPORTS_PER_LAUNCH) {
        sent += 1;
        const report = buildErrorReport(error, { ...deps.meta(), fatal: Boolean(isFatal) });
        void deps.getToken().then((token) => sendErrorReport(token, report, deps.fetcher)).catch(() => false);
      }
    } catch {
      // Reporting must never make a crash worse.
    }
    previous(error, isFatal);
  });
}
