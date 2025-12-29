// Re-export shared types
export type {
  ThemeSettings,
  LinkedNote,
  ShareRequest,
  ThemeSyncRequest,
} from '@obsidian-note-share/shared';

// Worker-specific types

export interface Env {
  NOTES: R2Bucket;
  API_KEY: string;
}

export interface StoredNote {
  vault: string;
  titleSlug: string;
  hash: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  linkedNotes: { titleSlug: string; hash: string }[];
  retentionDays?: number;
}

export interface NoteIndex {
  notes: {
    titleSlug: string;
    hash: string;
    title: string;
    createdAt: string;
  }[];
}
