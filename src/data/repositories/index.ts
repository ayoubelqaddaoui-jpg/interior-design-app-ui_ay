/**
 * Single composition root. To plug the real backend, replace the factories below
 * with implementations of the interfaces in ./types — the UI never imports mocks directly.
 */
import type { DocRepositories, Repositories, Services } from './types';
import { createMockCollection, createMockDoc } from '../mock/collection';
import * as S from '../mock/seed';
import { backendEnabled, backendLogin } from '@/lib/backend';
import { remoteSpace, remoteUsers } from './remoteSpace';
import { remoteRequests } from './remoteRequests';
import { mockServices } from '../mock/services';

const localRequests = createMockCollection('requests', S.seedRequests);
export const repos: Repositories = {
  tabs: createMockCollection('tabs', S.seedTabs),
  tools: createMockCollection('tools', S.seedTools),
  roomTypes: createMockCollection('roomTypes', S.seedRoomTypes),
  styles: createMockCollection('styles', S.seedStyles),
  palettes: createMockCollection('palettes', S.seedPalettes),
  sections: createMockCollection('sections', S.seedSections),
  categories: createMockCollection('categories', S.seedCategories),
  inspirations: createMockCollection('inspirations', S.seedInspirations),
  models: createMockCollection('models', S.seedModels),
  users: backendEnabled ? remoteUsers(createMockCollection('users', () => S.seedUsers(S.defaultSettings().defaultFreeCredits))) : createMockCollection('users', () => S.seedUsers(S.defaultSettings().defaultFreeCredits)),
  requests: backendEnabled ? remoteRequests(localRequests) : localRequests,
  history: backendEnabled ? remoteSpace('history', createMockCollection('history', () => [])) : createMockCollection('history', () => []),
  conversations: backendEnabled ? remoteSpace('conversations', createMockCollection('conversations', () => [])) : createMockCollection('conversations', () => []),
};

export const docs: DocRepositories = {
  branding: createMockDoc('branding', S.defaultBranding),
  theme: createMockDoc('theme', S.defaultTheme),
  assistant: createMockDoc('assistant', S.defaultAssistant),
  settings: createMockDoc('settings', S.defaultSettings),
};

export const services: Services = backendEnabled ? { ...mockServices, auth: { loginAdmin: backendLogin } } : mockServices;
export { ME } from '../mock/seed';
export type * from './types';
