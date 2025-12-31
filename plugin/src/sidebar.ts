import { ItemView, WorkspaceLeaf, Notice, setIcon } from 'obsidian';
import type NoteSharePlugin from './main';
import { SharedNote } from './types';

export const VIEW_TYPE_SHARED_NOTES = 'shared-notes-view';

export class SharedNotesView extends ItemView {
  plugin: NoteSharePlugin;
  notes: SharedNote[] = [];
  private list: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;

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
    await this.buildUI();
    await this.refresh();
  }

  private buildUI(): void {
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

    // Search input
    this.searchInput = container.createEl('input', {
      type: 'text',
      placeholder: 'Filter notes...',
      cls: 'shared-notes-search',
    });
    this.searchInput.addEventListener('input', () => this.filterNotes());

    // Notes list with event delegation
    this.list = container.createEl('div', { cls: 'shared-notes-list' });
    this.list.addEventListener('click', (e) => this.handleListClick(e));
  }

  private async handleListClick(e: Event): Promise<void> {
    const target = e.target as HTMLElement;
    const btn = target.closest('button');
    if (!btn) return;

    const item = btn.closest('.shared-notes-item') as HTMLElement;
    if (!item) return;

    const hash = item.dataset.hash;
    const titleSlug = item.dataset.slug;
    const title = item.dataset.title;
    if (!hash || !titleSlug) return;

    const vault = this.plugin.getEffectiveVaultSlug();

    if (btn.classList.contains('copy-btn')) {
      const url = this.plugin.api.buildNoteUrl(vault, titleSlug, hash);
      await navigator.clipboard.writeText(url);
      new Notice('Link copied to clipboard');
    } else if (btn.classList.contains('copy-md-btn')) {
      const url = this.plugin.api.buildNoteUrl(vault, titleSlug, hash);
      await navigator.clipboard.writeText(`[${title}](${url})`);
      new Notice('Markdown link copied');
    } else if (btn.classList.contains('delete-btn')) {
      try {
        await this.plugin.api.deleteNote(vault, titleSlug, hash);
        new Notice('Note unshared');
        await this.refresh();
      } catch (e) {
        new Notice('Failed to delete note');
      }
    }
  }

  private filterNotes(): void {
    if (!this.list || !this.searchInput) return;

    const query = this.searchInput.value.toLowerCase();
    this.list.querySelectorAll('.shared-notes-item').forEach((item) => {
      const title = (item as HTMLElement).dataset.title?.toLowerCase() || '';
      (item as HTMLElement).style.display = title.includes(query) ? '' : 'none';
    });
  }

  async refresh(): Promise<void> {
    if (!this.list) return;

    if (!this.plugin.settings.serverUrl || !this.plugin.settings.apiKey) {
      this.list.innerHTML = '<p class="shared-notes-empty">Configure server URL and API key in settings.</p>';
      return;
    }

    try {
      const vault = this.plugin.getEffectiveVaultSlug();
      const newNotes = await this.plugin.api.listNotes(vault);

      // Build map of existing DOM items by hash for differential updates
      const existingItems = new Map<string, HTMLElement>();
      this.list.querySelectorAll('.shared-notes-item').forEach((el) => {
        const hash = (el as HTMLElement).dataset.hash;
        if (hash) existingItems.set(hash, el as HTMLElement);
      });

      // Track which items are still valid
      const validHashes = new Set<string>();

      // Update or create items
      for (const note of newNotes) {
        validHashes.add(note.hash);

        if (existingItems.has(note.hash)) {
          // Item already exists, keep it
          existingItems.delete(note.hash);
        } else {
          // Create new item
          this.createNoteItem(note);
        }
      }

      // Remove items no longer in list
      existingItems.forEach((el) => el.remove());

      // Show empty message if no notes
      if (newNotes.length === 0) {
        this.list.innerHTML = '<p class="shared-notes-empty">No shared notes yet. Right-click a note to share it.</p>';
      }

      this.notes = newNotes;

      // Re-apply filter if search has content
      if (this.searchInput?.value) {
        this.filterNotes();
      }
    } catch (e) {
      this.list.innerHTML = '<p class="shared-notes-error">Failed to load shared notes. Check your settings.</p>';
    }
  }

  private createNoteItem(note: SharedNote): void {
    if (!this.list) return;

    const item = this.list.createEl('div', { cls: 'shared-notes-item' });
    item.dataset.hash = note.hash;
    item.dataset.slug = note.titleSlug;
    item.dataset.title = note.title;

    const info = item.createEl('div', { cls: 'shared-notes-info' });
    info.createEl('span', { text: note.title, cls: 'shared-notes-title' });
    info.createEl('span', {
      text: new Date(note.createdAt).toLocaleDateString(),
      cls: 'shared-notes-date',
    });

    const actions = item.createEl('div', { cls: 'shared-notes-actions' });

    // Copy link button
    const copyBtn = actions.createEl('button', { cls: 'shared-notes-btn copy-btn' });
    setIcon(copyBtn, 'copy');
    copyBtn.setAttribute('aria-label', 'Copy link');

    // Copy markdown link button
    const copyMdBtn = actions.createEl('button', { cls: 'shared-notes-btn copy-md-btn' });
    setIcon(copyMdBtn, 'link');
    copyMdBtn.setAttribute('aria-label', 'Copy markdown link');

    // Delete button
    const deleteBtn = actions.createEl('button', {
      cls: 'shared-notes-btn shared-notes-btn-danger delete-btn',
    });
    setIcon(deleteBtn, 'trash');
    deleteBtn.setAttribute('aria-label', 'Delete');
  }

  async onClose(): Promise<void> {
    // Cleanup
  }
}
