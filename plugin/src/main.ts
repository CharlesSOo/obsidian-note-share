import { Notice, Plugin, TFile } from 'obsidian';
import { NoteShareSettings, DEFAULT_SETTINGS, ShareRequest, ThemeSettings } from './types';
import { NoteShareAPI } from './api';
import { NoteShareSettingTab } from './settings';
import { SharedNotesView, VIEW_TYPE_SHARED_NOTES } from './sidebar';

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

        menu.addItem((item) => {
          item
            .setTitle('Share Note')
            .setIcon('share')
            .onClick(() => this.shareNote(file));
        });

        if (this.settings.includeLinkedNotes) {
          menu.addItem((item) => {
            item
              .setTitle('Share Note + Links')
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
    if (!this.settings.autoSync) {
      console.log('[NoteShare] Auto-sync disabled');
      return;
    }

    const entry = this.settings.sharedNotes?.[file.path];
    if (!entry) {
      console.log(`[NoteShare] File not shared, skipping: ${file.path}`);
      return;
    }

    console.log(`[NoteShare] File modified, scheduling sync: ${file.path}`);
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

      // Process images and get rewritten content
      const processedContent = await this.processImages(file, content);

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
      console.error('Auto-sync failed:', e);
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
    return this.slugify(vaultName);
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
      console.error('Failed to sync theme:', e);
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
      const titleSlug = this.slugify(title);

      // Compute deterministic hash and URL immediately
      const hash = await this.computeNoteHash(vault, title);
      const url = `${this.settings.serverUrl}/g/${vault}/${titleSlug}/${hash}`;

      // Copy to clipboard FIRST - instant feedback
      await navigator.clipboard.writeText(url);
      new Notice(`Link copied! Uploading...`);

      // Now do the slow work: read content, process images, upload
      const content = await this.app.vault.read(file);
      const processedContent = await this.processImages(file, content);

      const request: ShareRequest = {
        vault,
        title,
        content: processedContent,
        retentionDays: this.settings.autoDeleteDays || 0,
      };

      // Handle linked notes
      if (includeLinks || this.settings.includeLinkedNotes) {
        const linkedNotes = await this.getLinkedNotes(file);
        if (linkedNotes.length > 0) {
          request.linkedNotes = linkedNotes;
        }
      }

      // Sync theme and upload note
      const theme = this.getThemeFromObsidian();
      await this.api.syncTheme({ vault, theme });
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
      console.error('Failed to share note:', e);
      new Notice(`Failed to share note: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async computeNoteHash(vault: string, title: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${vault}:${title}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async processImages(file: TFile, content: string): Promise<string> {
    // Generate hash for this note (same logic as server)
    const vault = this.getEffectiveVaultSlug();
    const title = file.basename;
    const noteHash = await this.computeNoteHash(vault, title);

    let processedContent = content;

    // Match ALL Obsidian-style embeds: ![[path]] or ![[path|alias]]
    const obsidianEmbedRegex = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gi;
    const obsidianMatches = [...content.matchAll(obsidianEmbedRegex)];

    // Match markdown-style images: ![alt](path.png)
    const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+\.(png|jpg|jpeg|gif|webp|svg))\)/gi;
    const markdownMatches = [...content.matchAll(markdownImageRegex)];

    // Process Obsidian-style embeds
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];

    for (const match of obsidianMatches) {
      const embedPath = match[1];  // Just the path, alias is parsed out
      const alias = match[2];      // Optional alias for alt text
      console.log(`[NoteShare] Processing embed: ![[${embedPath}${alias ? '|' + alias : ''}]]`);

      const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(embedPath, file.path);

      if (!resolvedFile) {
        console.log(`[NoteShare] Could not resolve file: ${embedPath}`);
        continue;
      }

      if (!(resolvedFile instanceof TFile)) {
        console.log(`[NoteShare] Resolved to non-file: ${embedPath}`);
        continue;
      }

      console.log(`[NoteShare] Resolved: ${resolvedFile.path} (ext: ${resolvedFile.extension})`);

      if (!imageExtensions.includes(resolvedFile.extension.toLowerCase())) {
        console.log(`[NoteShare] Not an image extension: ${resolvedFile.extension}`);
        continue;
      }

      try {
        console.log(`[NoteShare] Uploading image: ${resolvedFile.path}`);
        const imageData = await this.app.vault.readBinary(resolvedFile);
        const ext = resolvedFile.extension.toLowerCase();
        const contentType = this.getContentType(ext);
        const filename = resolvedFile.name; // Don't encode - server handles URL encoding

        const result = await this.api.uploadImage(noteHash, filename, imageData, contentType);
        console.log(`[NoteShare] Image uploaded: ${result.url}`);

        // Replace all occurrences of this embed with markdown image
        // Use alias if provided, otherwise use file basename
        const altText = alias || resolvedFile.basename;
        processedContent = processedContent.split(match[0]).join(`![${altText}](${result.url})`);
      } catch (e) {
        console.error(`[NoteShare] Failed to upload image ${embedPath}:`, e);
      }
    }

    // Process markdown-style images (local paths only)
    for (const match of markdownMatches) {
      const fullMatch = match[0];
      const alt = match[1];
      const imagePath = match[2];

      // Skip if already a URL
      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) continue;

      const imageFile = this.app.metadataCache.getFirstLinkpathDest(imagePath, file.path);

      if (imageFile instanceof TFile) {
        try {
          const imageData = await this.app.vault.readBinary(imageFile);
          const ext = imageFile.extension.toLowerCase();
          const contentType = this.getContentType(ext);
          const filename = imageFile.name; // Don't encode - server handles URL encoding

          const result = await this.api.uploadImage(noteHash, filename, imageData, contentType);

          // Replace all occurrences with uploaded URL
          processedContent = processedContent.split(fullMatch).join(`![${alt}](${result.url})`);
        } catch (e) {
          console.error(`Failed to upload image ${imagePath}:`, e);
        }
      }
    }

    // Clean up any remaining image embeds that couldn't be processed
    // This prevents them from breaking internal link processing on the server
    processedContent = processedContent.replace(
      /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gi,
      (match, path, alias) => `[Image: ${alias || path}]`
    );

    return processedContent;
  }

  getContentType(ext: string): string {
    const types: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    };
    return types[ext] || 'application/octet-stream';
  }

  async getLinkedNotes(file: TFile): Promise<{ title: string; content: string }[]> {
    const linkedNotes: { title: string; content: string }[] = [];
    const cache = this.app.metadataCache.getFileCache(file);

    if (!cache?.links) return linkedNotes;

    for (const link of cache.links) {
      const linkedFile = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);

      if (linkedFile instanceof TFile && linkedFile.extension === 'md') {
        const content = await this.app.vault.read(linkedFile);
        // Process images in linked notes too
        const processedContent = await this.processImages(linkedFile, content);
        const title = linkedFile.basename;
        linkedNotes.push({ title, content: processedContent });
      }
    }

    return linkedNotes;
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
