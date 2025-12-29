// Re-export shared types
export type {
  ThemeSettings,
  LinkedNote,
  ShareRequest,
  ShareResponse,
  ThemeSyncRequest,
} from '@obsidian-note-share/shared';

// Plugin-specific types

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
  autoDeleteDays: number; // 0 = never, else days until auto-delete
  sharedNotes: Record<string, SharedNoteEntry>; // keyed by filePath
}

export const DEFAULT_SETTINGS: NoteShareSettings = {
  serverUrl: '',
  apiKey: '',
  vaultName: '',
  includeLinkedNotes: false,
  autoSync: true,
  autoSyncDelay: 1,
  autoDeleteDays: 0,
  sharedNotes: {},
};

export interface SharedNote {
  titleSlug: string;
  hash: string;
  title: string;
  createdAt: string;
}

export interface ImageUploadResponse {
  url: string;
  key: string;
}
