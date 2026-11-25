// Adds build-time secrets to app.json without putting them in the repository.
//
//   GOOGLE_MAPS_ANDROID_KEY   Google Maps key for the Android map. Set it as an EAS
//                             environment variable (see docs/launch-checklist.md).
//                             Without it the Android app shows a notice instead of a map.
//
// Expo leaves android.config out of what the running app can read, so a plain
// yes/no is copied into extra for src/run/ui/RunMap.tsx. The key itself is not.
module.exports = ({ config }) => {
  const mapsKey = (process.env.GOOGLE_MAPS_ANDROID_KEY || '').trim();
  if (!mapsKey) return config;
  return {
    ...config,
    android: {
      ...config.android,
      config: { ...(config.android && config.android.config), googleMaps: { apiKey: mapsKey } },
    },
    extra: { ...config.extra, androidMapsKeyPresent: true },
  };
};
