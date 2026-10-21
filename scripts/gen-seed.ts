/**
 * Generates server/seed-content.json from the TypeScript seed data (`npm run gen:seed`).
 * The server inserts this JSON into the database exactly once (first request on an empty database);
 * after that the database is the only source of truth for all content and settings.
 */
import * as S from '../src/data/mock/seed';

// Node globals (this script runs under sucrase-node; the project does not ship @types/node).
declare const require: (id: string) => any;
declare const __dirname: string;
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const seed = {
  collections: {
    tabs: S.seedTabs(), tools: S.seedTools(), roomTypes: S.seedRoomTypes(), styles: S.seedStyles(), palettes: S.seedPalettes(),
    sections: S.seedSections(), categories: S.seedCategories(), inspirations: S.seedInspirations(), models: S.seedModels(), plans: S.seedPlans(),
  },
  docs: { branding: S.defaultBranding(), theme: S.defaultTheme(), assistant: S.defaultAssistant(), settings: S.defaultSettings() },
};
writeFileSync(join(__dirname, '..', 'server', 'seed-content.json'), JSON.stringify(seed));
console.log('seed written:', Object.entries(seed.collections).map(([k, v]) => `${k}=${v.length}`).join(' '));
