/** Automatic health import is off while FitPro records runs itself.
 * A runner who records in FitPro and on a watch would otherwise get the run twice:
 * once from FitPro and once imported. Importing a run by hand stays available, and the
 * server skips a hand-imported copy that overlaps a run FitPro recorded.
 * Revisit with the watch companion (design spec, section 9.3).
 */
export const AUTO_HEALTH_IMPORT_ENABLED = false;
