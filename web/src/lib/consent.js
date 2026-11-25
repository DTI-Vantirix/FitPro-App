export const CONSENT_VERSION = '2026-11-25';
export const POLICY_UPDATED = 'November 25, 2026';

export const hasConsented = (user) => Boolean(user) && user.consent_version === CONSENT_VERSION;