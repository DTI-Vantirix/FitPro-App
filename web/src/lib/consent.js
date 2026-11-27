// Raised when the privacy policy changes in a way people should agree to again.
// 2026-11-27: the policy names Stripe and Apple as payment providers.
export const CONSENT_VERSION = '2026-11-27';
export const POLICY_UPDATED = 'November 27, 2026';
export const TERMS_UPDATED = 'November 27, 2026';

export const hasConsented = (user) => Boolean(user) && user.consent_version === CONSENT_VERSION;