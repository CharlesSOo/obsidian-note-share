/**
 * Theme settings captured from Obsidian
 */
export interface ThemeSettings {
  backgroundPrimary: string;
  backgroundSecondary: string;
  textNormal: string;
  textMuted: string;
  textAccent: string;
  interactiveAccent: string;
  codeBackground: string;
  fontSize: number;
}

/**
 * Dual theme storage - supports light and dark modes
 */
export interface DualThemeSettings {
  light?: ThemeSettings;
  dark?: ThemeSettings;
  updatedAt?: string; // Set by worker when storing
}

/**
 * Linked note content
 */
export interface LinkedNote {
  title: string;
  content: string;
}

/**
 * Request to share a note
 */
export interface ShareRequest {
  vault: string;
  title: string;
  content: string;
  linkedNotes?: LinkedNote[];
  retentionDays?: number;
}

/**
 * Response after sharing a note
 */
export interface ShareResponse {
  url: string;
  titleSlug: string;
  hash: string;
}

/**
 * Request to sync theme settings
 */
export interface ThemeSyncRequest {
  vault: string;
  theme: ThemeSettings;
  mode: 'light' | 'dark';
}
