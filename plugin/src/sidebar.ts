import { ItemView, WorkspaceLeaf, Notice, setIcon } from 'obsidian';
import type NoteSharePlugin from './main';
import { SharedNote } from './types';

export const VIEW_TYPE_SHARED_NOTES = 'shared-notes-view';

export class SharedNotesView extends ItemView {
  plugin: NoteSharePlugin;
  notes: SharedNote[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: NoteSharePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SHARED_NOTES;
  }

  getDisplayText(): string {
    return 'Shared Notes';
  }

  getIcon(): string {
    return 'share';
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();

    // Header with buttons
    const header = container.createEl('div', { cls: 'shared-notes-header' });
    header.createEl('h4', { text: 'Shared Notes' });

    const headerActions = header.createEl('div', { cls: 'shared-notes-header-actions' });

    // Sync Theme button
    const syncBtn = headerActions.createEl('button', {
      cls: 'shared-notes-sync-btn',
      attr: { 'aria-label': 'Sync theme' },
    });
    setIcon(syncBtn, 'palette');
    syncBtn.createEl('span', { text: 'Sync Theme' });
    syncBtn.addEventListener('click', async () => {
      await this.plugin.syncTheme();
    });

    // Refresh button
    const refreshBtn = headerActions.createEl('button', { cls: 'shared-notes-refresh' });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.setAttribute('aria-label', 'Refresh');
    refreshBtn.addEventListener('click', () => this.refresh());

    if (!this.plugin.settings.serverUrl || !this.plugin.settings.apiKey) {
      container.createEl('p', {
        text: 'Configure server URL and API key in settings.',
        cls: 'shared-notes-empty',
      });
      return;
    }

    try {
      const vault = this.plugin.getEffectiveVaultSlug();
      this.notes = await this.plugin.api.listNotes(vault);
    } catch (e) {
      container.createEl('p', {
        text: 'Failed to load shared notes. Check your settings.',
        cls: 'shared-notes-error',
      });
      return;
    }

    if (this.notes.length === 0) {
      container.createEl('p', {
        text: 'No shared notes yet. Right-click a note to share it.',
        cls: 'shared-notes-empty',
      });
      return;
    }

    const list = container.createEl('div', { cls: 'shared-notes-list' });

    for (const note of this.notes) {
      const item = list.createEl('div', { cls: 'shared-notes-item' });

      const info = item.createEl('div', { cls: 'shared-notes-info' });
      info.createEl('span', { text: note.title, cls: 'shared-notes-title' });
      info.createEl('span', {
        text: new Date(note.createdAt).toLocaleDateString(),
        cls: 'shared-notes-date',
      });

      const actions = item.createEl('div', { cls: 'shared-notes-actions' });

      // Copy link button
      const copyBtn = actions.createEl('button', { cls: 'shared-notes-btn' });
      setIcon(copyBtn, 'copy');
      copyBtn.setAttribute('aria-label', 'Copy link');
      copyBtn.addEventListener('click', async () => {
        const vault = this.plugin.getEffectiveVaultSlug();
        const url = this.plugin.api.buildNoteUrl(vault, note.titleSlug, note.hash);
        await navigator.clipboard.writeText(url);
        new Notice('Link copied to clipboard');
      });

      // Delete button
      const deleteBtn = actions.createEl('button', {
        cls: 'shared-notes-btn shared-notes-btn-danger',
      });
      setIcon(deleteBtn, 'trash');
      deleteBtn.setAttribute('aria-label', 'Delete');
      deleteBtn.addEventListener('click', async () => {
        try {
          const vault = this.plugin.getEffectiveVaultSlug();
          await this.plugin.api.deleteNote(vault, note.titleSlug, note.hash);
          new Notice('Note unshared');
          await this.refresh();
        } catch (e) {
          new Notice('Failed to delete note');
        }
      });
    }
  }

  async onClose(): Promise<void> {
    // Cleanup
  }
}
