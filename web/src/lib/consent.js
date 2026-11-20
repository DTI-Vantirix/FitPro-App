export const CONSENT_VERSION = '2026-11-08';
export const POLICY_UPDATED = 'November 8, 2026';

export const hasConsented = (user) => Boolean(user) && user.consent_version === CONSENT_VERSION;