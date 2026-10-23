# Android APK on GitHub Releases

Every version of the Android app is published as a downloadable APK on
**https://github.com/elqaddaoui/interior-design-app-ui/releases** by the workflow
`.github/workflows/android-release.yml` (source: `scripts/ci/android-release.yml`, see *Activate*) (GitHub Actions, no Expo account needed).

## Activate (one time, 1 minute)
The workflow is stored at `scripts/ci/android-release.yml` because the AI assistant's GitHub app is not allowed to
create workflow files. Move it once in the GitHub website:
1. Open `scripts/ci/android-release.yml` on GitHub (branch `main`) and click the **pencil** (Edit).
2. In the file name box at the top, replace the path with `.github/workflows/android-release.yml`
   (type `../../` to go up, then `.github/workflows/`).
3. **Commit changes** to `main`. The *Android release* workflow now appears in the **Actions** tab.

(Alternative: Settings → GitHub Apps → give the app the *Workflows* permission, and it can do this itself.)

## Download on the phone
1. Open the Releases page on the Android phone and tap the newest **Dwira X.Y.Z**.
2. Under *Assets*, tap `Dwira-X.Y.Z.apk`.
3. When Android asks, allow **Install unknown apps** for your browser, then tap **Install**.
4. Later versions install over the previous one (same signing key, higher version code). Data and sign-in are kept.

The app uses the deployed API (`https://interior-design-app-ui-7rjz.vercel.app/api`, the same database as the website).
To point it somewhere else, set the repository variable `EXPO_PUBLIC_API_URL` (Settings → Secrets and variables →
Actions → Variables) before releasing.

## Publish a new version (every update)
Releases are created from version tags. After the change is merged into `main`:

```bash
git checkout main && git pull
git tag v1.1.0            # next version: X.Y.Z, always higher than the previous tag
git push origin v1.1.0
```

Or without a terminal: GitHub → **Actions** → **Android release** → **Run workflow** → enter `1.1.0`.

The workflow (~15-25 min) builds a signed APK, creates the release `v1.1.0` with automatic release notes (merged PRs
since the previous tag) and attaches `Dwira-1.1.0.apk`. Re-running the same version replaces the APK.
Version numbers: `MAJOR.MINOR.PATCH` (new feature → MINOR, fix → PATCH). The Android `versionCode` is derived from it.

## One-time setup: signing key (required for updates to install over the previous version)
Without these secrets the workflow still builds, but with a temporary key: every APK must then be uninstalled before
installing the next one. Create the key once and keep a backup (losing it means users must reinstall):

```bash
keytool -genkeypair -v -keystore dwira-release.keystore -alias dwira -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 dwira-release.keystore > keystore.b64      # macOS: base64 -i dwira-release.keystore > keystore.b64
```

GitHub → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | content of `keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `dwira` |
| `ANDROID_KEY_PASSWORD` | key password (same as the keystore password if you pressed Enter) |

## How it works
`expo prebuild` generates `android/` (never committed, see AGENTS.md) with `APP_VERSION` / `APP_VERSION_CODE` read by
`app.config.js`; `scripts/android-signing.js` switches release builds to the release key; Gradle `assembleRelease`
builds the APK (arm64-v8a + armeabi-v7a); `gh release create` publishes it.
