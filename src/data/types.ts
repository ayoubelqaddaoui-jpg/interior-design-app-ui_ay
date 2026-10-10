/** Domain model. Every admin-editable text is an `LText` with one value per language. */
export type Lang = 'dar' | 'ar' | 'fr';
export type LText = Record<Lang, string>;
export type Id = string;

export type Media = { type: 'image' | 'video'; uri: string; poster?: string };
export type StepKey = 'room' | 'style' | 'mode' | 'model';
export type Group = 'interior' | 'exterior';
export type RenderMode = 'restyle' | 'renovation';

type Ordered = { order: number; visible: boolean };

export interface HomeTab extends Ordered { id: Id; title: LText }

export interface Tool extends Ordered {
  id: Id;
  tabId: Id;
  title: LText;
  subtitle: LText;
  media: Media;
  /** Enabled optional wizard steps (the photo step is always first). */
  steps: StepKey[];
  /** AI models the admin allows for this tool. */
  modelIds: Id[];
  roomGroup: Group;
}

export interface RoomType extends Ordered {
  id: Id;
  title: LText;
  group: Group;
  displayMode: 'icon' | 'image';
  icon: string;
  image: string;
  isNew: boolean;
}

export interface StyleItem extends Ordered { id: Id; title: LText; image: string }
export interface Palette extends Ordered { id: Id; title: LText; colors: string[]; isSurprise: boolean }

export interface InspirationSection extends Ordered {
  id: Id;
  title: LText;
  icon: string;
  /** Tool opened by "Use this style". */
  toolId: Id;
}
export interface InspirationCategory extends Ordered {
  id: Id;
  sectionId: Id;
  title: LText;
  cover: string;
  roomTypeId?: Id;
}
export interface InspirationItem extends Ordered {
  id: Id;
  categoryId: Id;
  image: string;
  styleId?: Id;
}

export interface AiModel {
  id: Id;
  name: string;
  provider: string;
  modelName: string;
  apiKey: string;
  enabled: boolean;
  isDefault: boolean;
  order: number;
  visible: boolean;
}

export interface AppUser {
  id: Id;
  name: string;
  whatsapp: string;
  credits: number;
  /** true once the user went through the first-free-render WhatsApp flow. */
  leadDone: boolean;
  role: 'user' | 'admin';
  createdAt: number;
}

export interface Draft {
  toolId: Id;
  roomTypeId?: Id;
  styleId?: Id;
  mode?: RenderMode;
  paletteId?: Id;
  modelId?: Id;
}
export interface WizardDraft extends Draft { photoUri: string }

export interface HistoryItem {
  requestId?: Id;
  id: Id;
  userId: Id;
  before: string;
  after?: string;
  status: 'done' | 'pending';
  draft: Draft;
  createdAt: number;
}

export type RequestStatus = 'pending' | 'processing' | 'delivered';
export interface RenderRequest {
  id: Id;
  userId: Id;
  name: string;
  whatsapp: string;
  photoUri: string;
  draft: Draft;
  aiResult?: string;
  finalResult?: string;
  status: RequestStatus;
  autoSent?: boolean;
  historyId?: Id;
  createdAt: number;
}

export interface ChatMessage { id: Id; role: 'user' | 'assistant'; text: string; image?: string; createdAt: number }
export interface Conversation { id: Id; userId: Id; title: string; messages: ChatMessage[]; updatedAt: number }

/* ---- single documents ---- */
export interface Branding { appName: string; logoUri: string }
export type ThemeId = 'light' | 'dark' | 'royal' | 'custom';
export interface ThemeConfig { active: ThemeId; custom: Record<string, string> }
export interface AssistantConfig {
  type: 'ai' | 'whatsapp';
  modelId: Id;
  systemPrompt: string;
  whatsappNumber: string;
  welcome: LText;
}
export interface AppSettings { defaultFreeCredits: number; autoSendWhatsApp: boolean }

export interface CollMap {
  tabs: HomeTab;
  tools: Tool;
  roomTypes: RoomType;
  styles: StyleItem;
  palettes: Palette;
  sections: InspirationSection;
  categories: InspirationCategory;
  inspirations: InspirationItem;
  models: AiModel;
  users: AppUser;
  requests: RenderRequest;
  history: HistoryItem;
  conversations: Conversation;
}
export interface DocMap {
  branding: Branding;
  theme: ThemeConfig;
  assistant: AssistantConfig;
  settings: AppSettings;
}
export type CollName = keyof CollMap;
export type DocName = keyof DocMap;
