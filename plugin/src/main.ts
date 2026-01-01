import { Notice, Plugin, TFile } from 'obsidian';
import { slugify, generateNoteHash } from '@obsidian-note-share/shared';
import { NoteShareSettings, DEFAULT_SETTINGS, ShareRequest, ThemeSettings } from './types';
import { NoteShareAPI } from './api';
import { NoteShareSettingTab } from './settings';
import { SharedNotesView, VIEW_TYPE_SHARED_NOTES } from './sidebar';
import { Semaphore, processImages } from './image-processing';

export default class NoteSharePlugin extends Plugin {
  settings: NoteShareSettings;
  api: NoteShareAPI;

  // Track last API config for smart recreation
  private lastApiUrl: string = '';
  private lastApiKey: string = '';

  // Auto-sync tracking - simple debounce pattern
  private pendingSyncs: Map<string, ReturnType<typeof setTimeout>> = new Map();

  async onload() {
    await this.loadSettings();
    this.api = new NoteShareAPI(this.settings);
    this.lastApiUrl = this.settings.serverUrl;
    this.lastApiKey = this.settings.apiKey;

    // Check and sync theme if changed (runs after workspace is ready)
    this.app.workspace.onLayoutReady(() => {
      this.checkAndSyncTheme();
    });

    // Register sidebar view
    this.registerView(VIEW_TYPE_SHARED_NOTES, (leaf) => new SharedNotesView(leaf, this));

    // Add ribbon icon to open sidebar
    this.addRibbonIcon('share', 'Shared Notes', () => {
      this.activateSidebarView();
    });

    // Add right-click menu item
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;

        menu.addItem((item) => {
          item
            .setTitle('Share Note')
            .setIcon('share')
            .onClick(() => this.shareNote(file));
        });
        menu.addItem((item) => {
          item
            .setTitle('Share Note + Linked Notes')
            .setIcon('share-2')
            .onClick(() => this.shareNote(file, true));
        });
      })
    );

    // Add command
    this.addCommand({
      id: 'share-current-note',
      name: 'Share current note',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === 'md') {
          if (!checking) {
            this.shareNote(file);
          }
          return true;
        }
        return false;
      },
    });

    // Add sync theme command
    this.addCommand({
      id: 'sync-theme',
      name: 'Sync theme to shared notes',
      callback: () => this.syncTheme(),
    });

    // Add settings tab
    this.addSettingTab(new NoteShareSettingTab(this.app, this));

    // Watch for file modifications (auto-sync)
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.handleFileModify(file);
        }
      })
    );

    // Handle file renames
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (this.settings.sharedNotes?.[oldPath]) {
          this.settings.sharedNotes[file.path] = {
            ...this.settings.sharedNotes[oldPath],
            filePath: file.path,
          };
          delete this.settings.sharedNotes[oldPath];
          this.saveSettings();
        }
      })
    );

    // Handle file deletes
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (this.settings.sharedNotes?.[file.path]) {
          delete this.settings.sharedNotes[file.path];
          this.saveSettings();
        }
      })
    );
  }

  handleFileModify(file: TFile) {
    if (!this.settings.autoSync) return;
    if (!this.settings.sharedNotes?.[file.path]) return;

    // Clear existing pending sync for this file
    const existing = this.pendingSyncs.get(file.path);
    if (existing) clearTimeout(existing);

    // Schedule new debounced sync
    const delay = (this.settings.autoSyncDelay || 1) * 60 * 1000;
    const timeout = setTimeout(() => {
      this.pendingSyncs.delete(file.path);
      this.autoSyncNote(file);
    }, delay);

    this.pendingSyncs.set(file.path, timeout);
    console.log(`[NoteShare] Scheduled sync in ${delay / 1000}s: ${file.path}`);
  }

  async autoSyncNote(file: TFile) {
    console.log(`[NoteShare] Auto-syncing: ${file.path}`);
    try {
      const content = await this.app.vault.read(file);
      const vault = this.getEffectiveVaultSlug();

      // Create semaphore for parallel image uploads
      const semaphore = new Semaphore();

      // Process images and get rewritten content
      const processedContent = await processImages(this.app, this.api, file, content, vault, semaphore);

      await this.api.shareNote({
        vault,
        title: file.basename,
        content: processedContent,
      });

      // Update lastSynced
      if (this.settings.sharedNotes?.[file.path]) {
        this.settings.sharedNotes[file.path].lastSynced = new Date().toISOString();
        await this.saveSettings();
      }
    } catch (e) {
      console.error('[NoteShare] Auto-sync failed:', e);
    }
  }

  async activateSidebarView() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_SHARED_NOTES)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({
          type: VIEW_TYPE_SHARED_NOTES,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  getVaultSlug(): string {
    const vaultName = this.app.vault.getName();
    return slugify(vaultName);
  }

  getEffectiveVaultSlug(): string {
    return this.settings.vaultName || this.getVaultSlug();
  }

  getObsidianThemeMode(): 'light' | 'dark' {
    return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  }

  getThemeFromObsidian(): ThemeSettings {
    const style = getComputedStyle(document.body);
    return {
      backgroundPrimary: style.getPropertyValue('--background-primary').trim() || '#1e1e1e',
      backgroundSecondary: style.getPropertyValue('--background-secondary').trim() || '#262626',
      textNormal: style.getPropertyValue('--text-normal').trim() || '#dcddde',
      textMuted: style.getPropertyValue('--text-muted').trim() || '#999',
      textAccent: style.getPropertyValue('--text-accent').trim() || '#7c3aed',
      interactiveAccent: style.getPropertyValue('--interactive-accent').trim() || '#7c3aed',
      codeBackground: style.getPropertyValue('--code-background').trim() || '#2d2d2d',
      fontSize: parseInt(style.fontSize) || 16,
    };
  }

  computeThemeHash(theme: ThemeSettings): string {
    // Simple hash of theme JSON for change detection
    const str = JSON.stringify(theme);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  async checkAndSyncTheme(): Promise<void> {
    if (!this.settings.serverUrl || !this.settings.apiKey) return;

    const theme = this.getThemeFromObsidian();
    const currentHash = this.computeThemeHash(theme);

    if (currentHash !== this.settings.lastThemeHash) {
      console.log('[NoteShare] Theme changed, syncing...');
      await this.syncTheme(false); // silent sync on startup
    }
  }

  async syncTheme(notify = true): Promise<void> {
    if (!this.settings.serverUrl || !this.settings.apiKey) {
      if (notify) new Notice('Please configure server URL and API key in settings');
      return;
    }

    try {
      const mode = this.getObsidianThemeMode();
      if (notify) new Notice(`Syncing ${mode} theme...`);
      const theme = this.getThemeFromObsidian();
      const vault = this.getEffectiveVaultSlug();

      await this.api.syncTheme({ vault, theme, mode });

      // Save hash after successful sync
      this.settings.lastThemeHash = this.computeThemeHash(theme);
      await this.saveSettings();

      if (notify) new Notice(`${mode.charAt(0).toUpperCase() + mode.slice(1)} theme synced`);
    } catch (e) {
      console.error('[NoteShare] Failed to sync theme:', e);
      if (notify) new Notice(`Failed to sync theme: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  async shareNote(file: TFile, includeLinks = false): Promise<void> {
    if (!this.settings.serverUrl || !this.settings.apiKey) {
      new Notice('Please configure server URL and API key in settings');
      return;
    }

    try {
      const title = file.basename;
      const vault = this.getEffectiveVaultSlug();
      const titleSlug = slugify(title);

      // Compute deterministic hash and URL immediately
      const hash = await generateNoteHash(vault, title);
      const url = `${this.settings.serverUrl}/g/${vault}/${titleSlug}/${hash}`;

      // Copy to clipboard FIRST - instant feedback
      await navigator.clipboard.writeText(url);
      new Notice(`Link copied! Uploading...`);

      // Create shared semaphore for all parallel operations
      const semaphore = new Semaphore();

      // Read main note content
      const content = await this.app.vault.read(file);

      // Start main note images FIRST (queued first in semaphore)
      const mainImagesPromise = processImages(this.app, this.api, file, content, vault, semaphore);

      // Start linked notes processing (queued after main images)
      const linkedNotesPromise = includeLinks
        ? this.getLinkedNotes(file, semaphore)
        : Promise.resolve([]);

      // Wait for main note images first
      const processedContent = await mainImagesPromise;

      const request: ShareRequest = {
        vault,
        title,
        content: processedContent,
        retentionDays: this.settings.autoDeleteDays || 0,
      };

      // Wait for linked notes
      const linkedNotes = await linkedNotesPromise;
      if (linkedNotes.length > 0) {
        request.linkedNotes = linkedNotes;
      }

      // Upload note
      await this.api.shareNote(request);

      // Register as shared note for auto-sync
      if (!this.settings.sharedNotes) {
        this.settings.sharedNotes = {};
      }
      this.settings.sharedNotes[file.path] = {
        filePath: file.path,
        titleSlug,
        hash,
        lastSynced: new Date().toISOString(),
      };
      await this.saveSettings();
      console.log(`[NoteShare] Registered for auto-sync: ${file.path}`);

      new Notice(`Uploaded: ${url}`);

      // Refresh sidebar if open
      const views = this.app.workspace.getLeavesOfType(VIEW_TYPE_SHARED_NOTES);
      for (const leaf of views) {
        const view = leaf.view as SharedNotesView;
        await view.refresh();
      }
    } catch (e) {
      console.error('[NoteShare] Failed to share note:', e);
      new Notice(`Failed to share note: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  async getLinkedNotes(file: TFile, semaphore: Semaphore): Promise<{ title: string; content: string }[]> {
    const cache = this.app.metadataCache.getFileCache(file);

    if (!cache?.links) return [];

    const vault = this.getEffectiveVaultSlug();

    // Build tasks for all linked notes
    type LinkedNoteResult = { title: string; content: string } | undefined;
    const tasks: Promise<LinkedNoteResult>[] = [];

    for (const link of cache.links) {
      const linkedFile = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);

      if (linkedFile instanceof TFile && linkedFile.extension === 'md') {
        tasks.push(
          semaphore.run(async () => {
            console.log(`[NoteShare] Processing linked note: ${linkedFile.path}`);
            const content = await this.app.vault.read(linkedFile);
            // Pass same semaphore to processImages
            const processedContent = await processImages(this.app, this.api, linkedFile, content, vault, semaphore);
            return { title: linkedFile.basename, content: processedContent };
          })
        );
      }
    }

    // Run all in parallel (semaphore limits concurrency)
    const results = await Promise.all(tasks);
    return results.filter((n): n is { title: string; content: string } => n !== undefined);
  }

  onunload() {
    // Clear all pending sync timeouts
    for (const timeout of this.pendingSyncs.values()) {
      clearTimeout(timeout);
    }
    this.pendingSyncs.clear();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);

    // Only recreate API client if URL or API key changed
    if (this.settings.serverUrl !== this.lastApiUrl || this.settings.apiKey !== this.lastApiKey) {
      this.api = new NoteShareAPI(this.settings);
      this.lastApiUrl = this.settings.serverUrl;
      this.lastApiKey = this.settings.apiKey;
    }
  }
}
