export interface SharedNoteEntry {
  filePath: string;
  titleSlug: string;
  hash: string;
  lastSynced: string;
}

export interface NoteShareSettings {
  serverUrl: string;
  apiKey: string;
  vaultName: string;
  includeLinkedNotes: boolean;
  autoSync: boolean;
  autoSyncDelay: number; // minutes
  sharedNotes: Record<string, SharedNoteEntry>; // keyed by filePath
}

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

export const DEFAULT_SETTINGS: NoteShareSettings = {
  serverUrl: '',
  apiKey: '',
  vaultName: '',
  includeLinkedNotes: false,
  autoSync: true,
  autoSyncDelay: 2,
  sharedNotes: {},
};

export interface ShareRequest {
  vault: string;
  title: string;
  content: string;
  linkedNotes?: { title: string; content: string }[];
}

export interface ShareResponse {
  url: string;
  titleSlug: string;
  hash: string;
}

export interface SharedNote {
  titleSlug: string;
  hash: string;
  title: string;
  createdAt: string;
}

export interface ThemeSyncRequest {
  vault: string;
  theme: ThemeSettings;
}

export interface ImageUploadResponse {
  url: string;
  key: string;
}
