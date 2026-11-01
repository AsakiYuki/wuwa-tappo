export const RARITIES = ["common", "uncommon", "rare", "epic"] as const;

export type Rarity = (typeof RARITIES)[number];
export type ItemType = "character" | "accessory" | "emote";
export type SynthesisMode = "same" | "upgrade";

export interface CatalogItem {
  id: string;
  type: ItemType;
  rarity: Rarity;
  name: string;
  image: string;
  thumbnail: string;
  roleId?: number;
  code?: string;
  starter?: boolean;
  offsetX?: number;
  offsetY?: number;
  layers?: Record<string, string>;
}

export interface PetPosition {
  x: number;
  y: number;
}

export type HandAnimationMode =
  | "adaptive"
  | "alternate"
  | "random"
  | "right"
  | "left";

export interface Settings {
  scale: number;
  opacity: number;
  alwaysOnTop: boolean;
  passthrough: boolean;
  inputEnabled: boolean;
  autoStart: boolean;
  monitor: number;
  lockDrag: boolean;
  hoverFade: boolean;
  showChest: boolean;
  showKeyboard: boolean;
  counterLeft: boolean;
  counterLimit: number | null;
  handAnimation: HandAnimationMode;
  petPosition: PetPosition | null;
}

export interface Preset {
  id: string;
  name: string;
  character: string;
  accessory: string;
  emotes: string[];
}

export interface HistoryEntry {
  id: string;
  fresh: boolean;
  source: "draw" | "synthesis";
  at: number;
}

export interface CollectionState {
  version: 2;
  owned: Record<string, number>;
  favorites: string[];
  presets: Preset[];
  character: string;
  accessory: string;
  emotes: string[];
  count: number;
  draws: number;
  pity: number;
  history: HistoryEntry[];
  settings: Settings;
}

export type RawCollection = Partial<Omit<CollectionState, "version">> & {
  version?: number;
};

export interface SynthesisOptions {
  type?: ItemType;
  mode?: SynthesisMode;
}

export interface SavedState {
  raw: RawCollection;
  file: string;
  mtime: number;
}

export interface ProfileResult {
  state: CollectionState;
  warning: string;
  migratedFrom?: string;
}
