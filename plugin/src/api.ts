import { NoteShareSettings, ShareRequest, ShareResponse, SharedNote, ThemeSettings, ThemeSyncRequest } from './types';

export interface StatusResponse {
  status: 'ok' | 'error';
  r2: boolean;
  version: string;
  error?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export class NoteShareAPI {
  constructor(private settings: NoteShareSettings) {}

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.settings.apiKey,
    };
  }

  async shareNote(request: ShareRequest): Promise<ShareResponse> {
    const url = `${this.settings.serverUrl}/api/share`;
    const body = JSON.stringify(request);
    console.log('API shareNote URL:', url);
    console.log('API shareNote body:', body.substring(0, 500));
    console.log('API shareNote headers:', this.headers);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body,
    });

    console.log('API shareNote response status:', response.status);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to share note: ${error}`);
    }

    return response.json();
  }

  async listNotes(vault: string): Promise<SharedNote[]> {
    const response = await fetch(`${this.settings.serverUrl}/api/notes?vault=${encodeURIComponent(vault)}`, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error('Failed to fetch shared notes');
    }

    return response.json();
  }

  async deleteNote(vault: string, titleSlug: string, hash: string): Promise<void> {
    const response = await fetch(
      `${this.settings.serverUrl}/api/notes/${encodeURIComponent(vault)}/${encodeURIComponent(titleSlug)}/${encodeURIComponent(hash)}`,
      {
        method: 'DELETE',
        headers: this.headers,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to delete note');
    }
  }

  async syncTheme(request: ThemeSyncRequest): Promise<void> {
    const response = await fetch(`${this.settings.serverUrl}/api/theme`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to sync theme: ${error}`);
    }
  }

  buildNoteUrl(vault: string, titleSlug: string, hash: string): string {
    return `${this.settings.serverUrl}/g/${titleSlug}/${hash}`;
  }

  async checkStatus(): Promise<ConnectionTestResult> {
    if (!this.settings.serverUrl) {
      return { success: false, message: 'Server URL is not configured' };
    }
    if (!this.settings.apiKey) {
      return { success: false, message: 'API key is not configured' };
    }

    try {
      const response = await fetch(`${this.settings.serverUrl}/api/status`, {
        method: 'GET',
        headers: this.headers,
      });

      if (response.status === 401) {
        return { success: false, message: 'Invalid API key' };
      }

      if (!response.ok) {
        const data: StatusResponse = await response.json();
        if (!data.r2) {
          return { success: false, message: 'R2 bucket not configured on worker' };
        }
        return { success: false, message: data.error || 'Server error' };
      }

      const data: StatusResponse = await response.json();
      if (data.status === 'ok') {
        return { success: true, message: 'Connected successfully!' };
      }

      return { success: false, message: data.error || 'Unknown error' };
    } catch (e) {
      if (e instanceof TypeError && e.message.includes('fetch')) {
        return { success: false, message: 'Server not reachable - check URL' };
      }
      return { success: false, message: `Connection failed: ${e instanceof Error ? e.message : 'Unknown error'}` };
    }
  }
}
