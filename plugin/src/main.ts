import { Notice, Plugin, TFile } from 'obsidian';
import { NoteShareSettings, DEFAULT_SETTINGS, ShareRequest, ThemeSettings } from './types';
import { NoteShareAPI } from './api';
import { NoteShareSettingTab } from './settings';
import { SharedNotesView, VIEW_TYPE_SHARED_NOTES } from './sidebar';

export default class NoteSharePlugin extends Plugin {
  settings: NoteShareSettings;
  api: NoteShareAPI;

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
      new Notice('Sharing note...');

      const content = await this.app.vault.read(file);
      const title = file.basename;
      const vault = this.getEffectiveVaultSlug();

      console.log('Share request:', { vault, title, contentLength: content.length });

      const request: ShareRequest = {
        vault,
        title,
        content,
      };

      console.log('Full request:', JSON.stringify(request).substring(0, 500));

      // Handle linked notes
      if (includeLinks || this.settings.includeLinkedNotes) {
        const linkedNotes = await this.getLinkedNotes(file);
        if (linkedNotes.length > 0) {
          request.linkedNotes = linkedNotes;
        }
      }

      // Also sync theme when sharing
      const theme = this.getThemeFromObsidian();
      await this.api.syncTheme({ vault, theme });

      const response = await this.api.shareNote(request);

      // Copy to clipboard
      await navigator.clipboard.writeText(response.url);
      new Notice(`Link copied: ${response.url}`);

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

  async getLinkedNotes(file: TFile): Promise<{ title: string; content: string }[]> {
    const linkedNotes: { title: string; content: string }[] = [];
    const cache = this.app.metadataCache.getFileCache(file);

    if (!cache?.links) return linkedNotes;

    for (const link of cache.links) {
      const linkedFile = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);

      if (linkedFile instanceof TFile && linkedFile.extension === 'md') {
        const content = await this.app.vault.read(linkedFile);
        const title = linkedFile.basename;
        linkedNotes.push({ title, content });
      }
    }

    return linkedNotes;
  }

  onunload() {
    // Cleanup
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.api = new NoteShareAPI(this.settings);
  }
}
