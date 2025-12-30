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

  // Auto-sync tracking
  private syncIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private syncTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  async onload() {
    await this.loadSettings();
    this.api = new NoteShareAPI(this.settings);

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

        if (this.settings.includeLinkedNotes) {
          // Setting enabled: just show one option (links already included)
          menu.addItem((item) => {
            item
              .setTitle('Share Note + Linked Notes')
              .setIcon('share-2')
              .onClick(() => this.shareNote(file));
          });
        } else {
          // Setting disabled: show both options
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
        }
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

    const entry = this.settings.sharedNotes?.[file.path];
    if (!entry) return;

    console.log(`[NoteShare] Scheduling sync: ${file.path}`);
    const delay = (this.settings.autoSyncDelay || 1) * 60 * 1000;

    // Start interval if not already running (syncs every 2 min)
    if (!this.syncIntervals.has(file.path)) {
      const interval = setInterval(() => this.autoSyncNote(file), delay);
      this.syncIntervals.set(file.path, interval);

      // Schedule first sync after delay
      setTimeout(() => this.autoSyncNote(file), delay);
    }

    // Reset "idle" timeout - if no edits for delay period, stop interval and final sync
    const existingTimeout = this.syncTimeouts.get(file.path);
    if (existingTimeout) clearTimeout(existingTimeout);

    const timeout = setTimeout(() => {
      // Stop interval
      const interval = this.syncIntervals.get(file.path);
      if (interval) clearInterval(interval);
      this.syncIntervals.delete(file.path);
      this.syncTimeouts.delete(file.path);

      // Final sync
      this.autoSyncNote(file);
    }, delay);

    this.syncTimeouts.set(file.path, timeout);
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

  async syncTheme(): Promise<void> {
    if (!this.settings.serverUrl || !this.settings.apiKey) {
      new Notice('Please configure server URL and API key in settings');
      return;
    }

    try {
      new Notice('Syncing theme...');
      const theme = this.getThemeFromObsidian();
      const vault = this.getEffectiveVaultSlug();

      await this.api.syncTheme({ vault, theme });
      new Notice('Theme synced successfully');
    } catch (e) {
      console.error('[NoteShare] Failed to sync theme:', e);
      new Notice(`Failed to sync theme: ${e instanceof Error ? e.message : 'Unknown error'}`);
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
      const shouldIncludeLinks = includeLinks || this.settings.includeLinkedNotes;
      const linkedNotesPromise = shouldIncludeLinks
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
    // Clear all sync intervals and timeouts
    for (const interval of this.syncIntervals.values()) {
      clearInterval(interval);
    }
    for (const timeout of this.syncTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.syncIntervals.clear();
    this.syncTimeouts.clear();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.api = new NoteShareAPI(this.settings);
  }
}
