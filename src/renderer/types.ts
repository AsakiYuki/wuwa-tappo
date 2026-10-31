export type ItemType = "character" | "accessory" | "emote";

export interface CatalogItem {
  id: string;
  type: ItemType;
  name: string;
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
  lockDrag: boolean;
  hoverFade: boolean;
  showChest: boolean;
  showKeyboard: boolean;
  counterLeft: boolean;
}

export interface PetState {
  character: string;
  accessory: string;
  emotes: string[];
  count: number;
  settings: PetSettings;
  owned: Record<string, number>;
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
  init(): Promise<{ state: PetState; items: CatalogItem[] }>;
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
    getItemName?: (item?: CatalogItem) => string;
    __petTest?: () => Record<string, unknown>;
    __studioTest?: () => Record<string, unknown>;
    emotionMotion?: {
      bind(button: HTMLButtonElement, image: HTMLImageElement): void;
      reduce: boolean;
    };
    floatEmotion?: (layer: HTMLElement, item: CatalogItem) => void;
  }
}
