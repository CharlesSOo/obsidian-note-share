export interface Env {
  NOTES: R2Bucket;
  API_KEY: string;
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
  updatedAt?: string;
}

export interface ShareRequest {
  vault: string;
  title: string;
  content: string;
  linkedNotes?: LinkedNote[];
}

export interface LinkedNote {
  title: string;
  content: string;
}

export interface StoredNote {
  vault: string;
  titleSlug: string;
  hash: string;
  title: string;
  content: string;
  createdAt: string;
  linkedNotes: { titleSlug: string; hash: string }[];
}

export interface NoteIndex {
  notes: {
    titleSlug: string;
    hash: string;
    title: string;
    createdAt: string;
  }[];
}

export interface ThemeSyncRequest {
  vault: string;
  theme: ThemeSettings;
}
