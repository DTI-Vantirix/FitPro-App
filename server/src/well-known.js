import { HANDLED } from './uploads.js';

// The two files Apple and Google fetch to decide whether a link to this site may open
// the phone app instead of the browser:
//
//   GET /.well-known/apple-app-site-association   iOS universal links
//   GET /.well-known/assetlinks.json              Android app links
//
// Only a friend invite link (/friends?add=<handle>) is handed to the app; every other
// page keeps opening in the browser. Both files are public: no sign-in, no redirect.
// The app's side of this is in native/app.json (associatedDomains, intentFilters).

/** iOS: the app ids (<team id>.<bundle id>) that may open /friends?add=<something>. */
export function appleAppSiteAssociation(appIds) {
  return {
    applinks: {
      details: [
        {
          appIDs: appIds,
          components: [{ '/': '/friends', '?': { add: '?*' }, comment: 'Friend invite links: /friends?add=<handle>' }],
        },
      ],
    },
  };
}

/** SHA-256 certificate fingerprints from a comma-separated setting, as Google writes them
 * (upper case, colon separated). Anything that is not 32 bytes of hex is left out. */
export function certFingerprints(value) {
  const found = String(value || '')
    .split(',')
    .map((item) => item.trim().replaceAll(':', '').toUpperCase())
    .filter((hex) => /^[0-9A-F]{64}$/.test(hex))
    .map((hex) => hex.match(/../g).join(':'));
  return [...new Set(found)];
}

/** Android: the statement that lets the app signed with one of these certificates open
 * this site's links. No certificate yet means no statement: an empty list. */
export function assetLinks(packageName, fingerprints) {
  if (!fingerprints.length) return [];
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: fingerprints },
    },
  ];
}

// Apple asks for exactly application/json on a file with no extension.
function sendFile(res, body) {
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(payload);
  return HANDLED;
}

export function registerWellKnownRoutes(router) {
  router.add('GET', '/.well-known/apple-app-site-association', ({ res, config }) =>
    sendFile(res, appleAppSiteAssociation(config.appLinks.iosAppIds))
  );
  router.add('GET', '/.well-known/assetlinks.json', ({ res, config }) =>
    sendFile(res, assetLinks(config.appLinks.androidPackage, config.appLinks.androidCertSha256))
  );
}
