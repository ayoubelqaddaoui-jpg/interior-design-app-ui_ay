#!/usr/bin/env node
/**
 * Release signing for the generated Android project (used by .github/workflows/android-release.yml after
 * `expo prebuild`). The template signs release builds with the public debug key; this adds a `release` signing config
 * that reads DWIRA_STORE_FILE / DWIRA_STORE_PASSWORD / DWIRA_KEY_ALIAS / DWIRA_KEY_PASSWORD from gradle.properties,
 * and makes the release build type use it. Fails loudly if the template ever changes shape.
 *   node scripts/android-signing.js android/app/build.gradle
 */
const fs = require('fs');
const file = process.argv[2] || 'android/app/build.gradle';
let gradle = fs.readFileSync(file, 'utf8');
if (gradle.includes('signingConfigs.release')) { console.log('[android-signing] already configured'); process.exit(0); }

const release = `
        release {
            storeFile file(DWIRA_STORE_FILE)
            storePassword DWIRA_STORE_PASSWORD
            keyAlias DWIRA_KEY_ALIAS
            keyPassword DWIRA_KEY_PASSWORD
        }`;
const configs = /signingConfigs\s*\{\s*\n(\s*debug\s*\{[^}]*\})/;
if (!configs.test(gradle)) throw new Error('signingConfigs { debug { ... } } not found in ' + file);
gradle = gradle.replace(configs, (all) => all + release);

const releaseType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
if (!releaseType.test(gradle)) throw new Error('release build type signing line not found in ' + file);
gradle = gradle.replace(releaseType, '$1signingConfig signingConfigs.release');

fs.writeFileSync(file, gradle);
console.log('[android-signing] release builds signed with', 'DWIRA_STORE_FILE');
