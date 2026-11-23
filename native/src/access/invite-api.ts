import { API_URL } from '../config';

// The FitPro API's inviteAccess function (see docs/native-contract.md).
// This is not a new backend endpoint and does not read or write health data.
export const INVITE_ACCESS_URL = `${API_URL}/api/functions/inviteAccess`;

export type InviteAccessResult = { allowed: boolean; admin?: boolean; error?: string };

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function requestInviteAccess(
  token: string,
  body: { action: 'status' } | { action: 'redeem'; code: string },
): Promise<InviteAccessResult> {
  if (!token) throw new Error('Missing app-user session. Sign in to continue.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(INVITE_ACCESS_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    if (controller.signal.aborted) throw new Error('Invite access request timed out. Check the network and retry.');
    throw new Error(`Invite access network error: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    clearTimeout(timeout);
  }
  const raw = await response.text();
  let data: Record<string, unknown>;
  try {
    data = asObject(JSON.parse(raw));
  } catch {
    throw new Error(`Invite access HTTP ${response.status}: unexpected response ${raw.slice(0, 200)}`);
  }
  const detail = typeof data.error === 'string' ? data.error : 'Invite access request failed';
  if (!response.ok) throw new Error(`Invite access HTTP ${response.status}: ${detail}`);
  if (typeof data.allowed !== 'boolean') throw new Error('Invite access response did not include allowed: boolean. Access denied.');
  return {
    allowed: data.allowed,
    ...(typeof data.admin === 'boolean' ? { admin: data.admin } : {}),
    ...(typeof data.error === 'string' ? { error: data.error } : {}),
  };
}

export async function getInviteStatus(token: string): Promise<InviteAccessResult> {
  return requestInviteAccess(token, { action: 'status' });
}

export async function redeemInviteCode(token: string, code: string): Promise<InviteAccessResult> {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) throw new Error('Enter an invite code.');
  return requestInviteAccess(token, { action: 'redeem', code: normalizedCode });
}
