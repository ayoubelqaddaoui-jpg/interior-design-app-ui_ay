/**
 * Single composition root. With the backend enabled (the default) every repository is a thin client of the
 * database API: content, settings, users, requests and per-user spaces have no local copy to drift from.
 * `EXPO_PUBLIC_BACKEND_MODE=demo` swaps in AsyncStorage mocks seeded from ./mock/seed for offline demos only.
 */
import type { DocRepositories, Repositories, Services } from './types';
import { createMockCollection, createMockDoc } from '../mock/collection';
import * as S from '../mock/seed';
import { backendEnabled, backendLogin } from '@/lib/backend';
import { remoteSpace, remoteUsers } from './remoteSpace';
import { remoteRequests } from './remoteRequests';
import { remoteCollection, remoteDoc } from './remoteContent';
import { mockServices } from '../mock/services';

const demo = (): Repositories => ({
  tabs: createMockCollection('tabs', S.seedTabs),
  tools: createMockCollection('tools', S.seedTools),
  roomTypes: createMockCollection('roomTypes', S.seedRoomTypes),
  styles: createMockCollection('styles', S.seedStyles),
  palettes: createMockCollection('palettes', S.seedPalettes),
  sections: createMockCollection('sections', S.seedSections),
  categories: createMockCollection('categories', S.seedCategories),
  inspirations: createMockCollection('inspirations', S.seedInspirations),
  models: createMockCollection('models', S.seedModels),
  plans: createMockCollection('plans', S.seedPlans),
  users: createMockCollection('users', () => S.seedUsers(S.defaultSettings().defaultFreeCredits)),
  requests: createMockCollection('requests', S.seedRequests),
  history: createMockCollection('history', () => []),
  conversations: createMockCollection('conversations', () => []),
});

const remote = (): Repositories => ({
  tabs: remoteCollection('tabs'),
  tools: remoteCollection('tools'),
  roomTypes: remoteCollection('roomTypes'),
  styles: remoteCollection('styles'),
  palettes: remoteCollection('palettes'),
  sections: remoteCollection('sections'),
  categories: remoteCollection('categories'),
  inspirations: remoteCollection('inspirations'),
  models: remoteCollection('models'),
  plans: remoteCollection('plans'),
  users: remoteUsers(),
  requests: remoteRequests(),
  // Signed-out visitors keep a device-only chat/history until they sign in (there is no identity to store it under).
  history: remoteSpace('history', createMockCollection('history', () => [])),
  conversations: remoteSpace('conversations', createMockCollection('conversations', () => [])),
});

export const repos: Repositories = backendEnabled ? remote() : demo();

export const docs: DocRepositories = backendEnabled
  ? { branding: remoteDoc('branding', S.defaultBranding), theme: remoteDoc('theme', S.defaultTheme), assistant: remoteDoc('assistant', S.defaultAssistant), settings: remoteDoc('settings', S.defaultSettings) }
  : { branding: createMockDoc('branding', S.defaultBranding), theme: createMockDoc('theme', S.defaultTheme), assistant: createMockDoc('assistant', S.defaultAssistant), settings: createMockDoc('settings', S.defaultSettings) };

export const services: Services = backendEnabled ? { ...mockServices, auth: { loginAdmin: backendLogin } } : mockServices;
export { ME } from '../mock/seed';
export type * from './types';
