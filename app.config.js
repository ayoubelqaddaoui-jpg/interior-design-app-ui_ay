/**
 * Dynamic layer over app.json (Expo merges both). Used by the Android release workflow:
 *  - APP_VERSION       (e.g. 1.4.0, from the git tag v1.4.0)  -> expo.version / Android versionName
 *  - APP_VERSION_CODE  (integer, always increasing)            -> android.versionCode (Android refuses to update to a lower one)
 * Without these variables (local development) app.json is used unchanged.
 */
module.exports = ({ config }) => {
  const version = process.env.APP_VERSION || config.version;
  const versionCode = Number(process.env.APP_VERSION_CODE) || config.android?.versionCode || 1;
  return { ...config, version, android: { ...config.android, versionCode } };
};
