import { api } from '@/api/client';

// Password sign-in. The FitPro API has no second sign-in step yet, so the result
// never carries mfa_required and the MFA screens are never reached from here.
export async function loginWithMfa(email, password) {
  return api.auth.login({ email, password });
}

export async function continueMfa() {
  throw new Error("Two-step sign-in isn't available yet.");
}

// provider: 'google' | 'microsoft' | 'facebook' | 'apple'
export async function loginWithSocial(provider, returnTo) {
  return api.auth.loginWithProvider(provider, returnTo);
}

export function loginWithGoogle(returnTo) {
  return loginWithSocial('google', returnTo);
}
