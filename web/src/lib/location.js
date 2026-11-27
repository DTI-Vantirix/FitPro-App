// Why the browser would not give a position, in words a runner can act on.
// Browsers only share location with secure pages (https, or localhost), so a
// plain http address on the home network is refused before anyone is asked.
export function locationProblem(err) {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'This address is not secure (http), so the browser will not share your location. Open the https address instead.';
  }
  if (!err) return 'This device cannot share a GPS location.';
  if (err.code === 1) return 'Location access is blocked. Allow location for this site, then reload.';
  return 'Waiting for a GPS signal — step outside for a clearer fix.';
}
