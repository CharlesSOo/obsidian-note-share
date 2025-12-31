import { NoteShareSettings, ShareRequest, ShareResponse, SharedNote, ThemeSyncRequest, ImageUploadResponse } from './types';

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

/**
 * Handle API response errors consistently
 */
async function handleResponseError(response: Response, context: string): Promise<never> {
  const errorText = await response.text().catch(() => 'Unknown error');
  throw new Error(`${context}: ${errorText || response.statusText}`);
}

export class NoteShareAPI {
  // Track in-flight share requests to prevent duplicates
  private inFlightShares = new Map<string, Promise<ShareResponse>>();

  constructor(private settings: NoteShareSettings) {}

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.settings.apiKey,
    };
  }

  async shareNote(request: ShareRequest): Promise<ShareResponse> {
    // Create unique key for this share request
    const key = `${request.vault}:${request.title}`;

    // Return existing in-flight request if one exists
    const existing = this.inFlightShares.get(key);
    if (existing) {
      console.log(`[NoteShare] Deduplicating share request: ${key}`);
      return existing;
    }

    // Create new request and track it
    const promise = this.doShareNote(request).finally(() => {
      this.inFlightShares.delete(key);
    });

    this.inFlightShares.set(key, promise);
    return promise;
  }

  private async doShareNote(request: ShareRequest): Promise<ShareResponse> {
    const response = await fetch(`${this.settings.serverUrl}/api/share`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      await handleResponseError(response, 'Failed to share note');
    }

    return response.json();
  }

  async listNotes(vault: string): Promise<SharedNote[]> {
    const response = await fetch(`${this.settings.serverUrl}/api/notes?vault=${encodeURIComponent(vault)}`, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      await handleResponseError(response, 'Failed to fetch notes');
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
      await handleResponseError(response, 'Failed to delete note');
    }
  }

  async syncTheme(request: ThemeSyncRequest): Promise<void> {
    const response = await fetch(`${this.settings.serverUrl}/api/theme`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      await handleResponseError(response, 'Failed to sync theme');
    }
  }

  buildNoteUrl(vault: string, titleSlug: string, hash: string): string {
    return `${this.settings.serverUrl}/g/${vault}/${titleSlug}/${hash}`;
  }

  async uploadImage(noteHash: string, filename: string, data: ArrayBuffer, contentType: string): Promise<ImageUploadResponse> {
    const response = await fetch(`${this.settings.serverUrl}/api/images/${noteHash}`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.settings.apiKey,
        'Content-Type': contentType,
        'X-Filename': filename,
      },
      body: data,
    });

    if (!response.ok) {
      await handleResponseError(response, 'Failed to upload image');
    }

    return response.json();
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
