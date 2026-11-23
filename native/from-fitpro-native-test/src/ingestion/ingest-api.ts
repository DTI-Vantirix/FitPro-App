import { INGEST_URL } from '../config';
import { SPIKE_WORKOUT } from './spike-workout';

export type IngestResult = {
  status: number;
  ok: boolean;
  rawResponse: string;
  action: string | null;
};

/** Never post without a real per-user token. Raw response is deliberately preserved for Step 1. */
export async function sendSyntheticWorkout(accessToken: string): Promise<IngestResult> {
  if (!accessToken) throw new Error('Missing app-user session. Sign in first.');
  const response = await fetch(INGEST_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(SPIKE_WORKOUT),
  });
  const rawResponse = await response.text();
  let action: string | null = null;
  try {
    const data: unknown = JSON.parse(rawResponse);
    if (data && typeof data === 'object' && 'action' in data) {
      const maybeAction = (data as { action?: unknown }).action;
      if (maybeAction === 'created' || maybeAction === 'updated') action = maybeAction;
    }
  } catch {
    // Raw text still shown; server may return a gateway error or HTML.
  }
  return { status: response.status, ok: response.ok, rawResponse, action };
}
