export type ItemType = "character" | "accessory" | "emote";

export interface CatalogItem {
  id: string;
  type: ItemType;
  assetId: number;
  roleId?: number;
  code?: string;
  name: string;
  rarity: "common" | "uncommon" | "rare" | "epic";
  image: string;
  thumbnail: string;
  layers?: Record<string, string>;
  offsetX?: number;
  offsetY?: number;
}

export interface PetSettings {
  scale: number;
  opacity: number;
  alwaysOnTop: boolean;
  passthrough: boolean;
  inputEnabled: boolean;
  autoStart: boolean;
  monitor: number;
  petPosition: { x: number; y: number } | null;
  lockDrag: boolean;
  hoverFade: boolean;
  showChest: boolean;
  showKeyboard: boolean;
  counterLeft: boolean;
  counterLimit: number | null;
  handAnimation: "adaptive" | "alternate" | "random" | "right" | "left";
}

export interface PetState {
  version: 2;
  character: string;
  accessory: string;
  emotes: string[];
  count: number;
  draws: number;
  pity: number;
  favorites: string[];
  presets: Preset[];
  history: HistoryRecord[];
  settings: PetSettings;
  owned: Record<string, number>;
}

export interface Preset {
  id: string;
  name: string;
  character: string;
  accessory: string;
  emotes: string[];
}

export interface HistoryRecord {
  id: string;
  fresh: boolean;
  source: "draw" | "synthesis";
  at: number;
}

export interface InputMessage {
  key: string;
  down: boolean;
  side: "left" | "right";
  count: number;
  serial: number;
}

export interface CommandResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  warning?: string;
}

export interface PetAPI {
  init(): Promise<{
    state: PetState;
    items: CatalogItem[];
    filters: {
      series: Record<string, string>;
      roles: Record<string, string>;
    };
    monitors: Array<{ id: number; label: string }>;
    status: { hook: string; warning?: string };
  }>;
  command(name: string, args?: unknown): Promise<CommandResult>;
  onState(callback: (state: PetState) => void): void;
  onInput(callback: (event: InputMessage) => void): void;
  onEmote(callback: (id: string) => void): void;
  onStatus(
    callback: (status: { hook: string; warning?: string }) => void,
  ): void;
  onPage(callback: (page: string) => void): void;
  move(dx: number, dy: number): void;
  resizeWindow(edge: string, dx: number, dy: number): void;
}

export function assetPath(file: string): string {
  return file.startsWith("assets/") ? `../${file}` : file;
}

declare global {
  interface Window {
    petAPI: PetAPI;
    __petTest?: () => Record<string, unknown>;
    __studioTest?: () => Record<string, unknown>;
    monitorCount: number;
  }
}
