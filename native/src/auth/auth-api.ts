import { API_URL, APP_AUTH_URL } from '../config';

export type MfaMethod = 'totp' | 'sms';
export type MfaChallenge = {
  mfaSessionToken: string;
  methods: MfaMethod[];
  nextStep: string | null;
};

export type LoginResult =
  | { kind: 'authenticated'; accessToken: string }
  | { kind: 'mfa'; challenge: MfaChallenge };

/** FitPro API auth: POST /api/auth/login returns { access_token, user }. Bearer token only, no cookies. */
async function postAuth(suffix: string, body: unknown, challengeToken?: string): Promise<unknown> {
  if (!API_URL) throw new Error('EXPO_PUBLIC_API_URL is not set. Add it to native/.env and restart Expo.');
  const response = await fetch(`${APP_AUTH_URL}/${suffix}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(challengeToken ? { Authorization: `Bearer ${challengeToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Auth HTTP ${response.status}: non-JSON response ${raw.slice(0, 250)}`);
  }
  if (!response.ok) {
    const record = object(data);
    const error = record.error;
    const nested = object(error);
    const message =
      (typeof nested.message === 'string' && nested.message) ||
      (typeof error === 'string' && error) ||
      (typeof record.detail === 'string' && record.detail) ||
      'Authentication request rejected';
    throw new Error(`Auth HTTP ${response.status}: ${message}`);
  }
  return data;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resultFromAuth(data: unknown): LoginResult {
  const record = object(data);
  if (typeof record.access_token === 'string' && record.access_token.length > 0) {
    return { kind: 'authenticated', accessToken: record.access_token };
  }
  if (record.mfa_required === true) {
    const methods = Array.isArray(record.mfa_methods)
      ? record.mfa_methods.filter((m): m is MfaMethod => m === 'totp' || m === 'sms')
      : [];
    if (typeof record.mfa_session_token !== 'string' || !record.mfa_session_token) {
      throw new Error('MFA required but the FitPro API did not return mfa_session_token. Stop.');
    }
    return {
      kind: 'mfa',
      challenge: {
        mfaSessionToken: record.mfa_session_token,
        methods,
        nextStep: typeof record.next_step === 'string' ? record.next_step : null,
      },
    };
  }
  throw new Error('No access_token or supported MFA challenge in the FitPro API login response. Stop.');
}

export async function login(email: string, password: string): Promise<LoginResult> {
  return resultFromAuth(await postAuth('login', { email: email.trim(), password }));
}

export async function verifyMfa(
  challenge: MfaChallenge,
  method: MfaMethod,
  code: string,
): Promise<string> {
  if (!challenge.methods.includes(method)) throw new Error('MFA method was not offered by the FitPro API.');
  const data = await postAuth(
    'mfa/verify',
    { code: code.trim(), method, remember_device: false },
    challenge.mfaSessionToken,
  );
  const result = resultFromAuth(data);
  if (result.kind !== 'authenticated') {
    throw new Error('MFA verification did not return a final app-user access token. Stop.');
  }
  return result.accessToken;
}

export async function resendSmsMfa(challenge: MfaChallenge): Promise<void> {
  if (!challenge.methods.includes('sms')) throw new Error('SMS is not an offered MFA method.');
  await postAuth('mfa/resend', undefined, challenge.mfaSessionToken);
}
