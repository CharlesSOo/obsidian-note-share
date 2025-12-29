import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type NoteSharePlugin from './main';

export class NoteShareSettingTab extends PluginSettingTab {
  plugin: NoteSharePlugin;

  constructor(app: App, plugin: NoteSharePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Connection
    containerEl.createEl('h3', { text: 'Connection' });

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('Your Cloudflare Worker URL')
      .addText((text) =>
        text
          .setPlaceholder('https://notes.yourname.workers.dev')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.replace(/\/$/, '');
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Secret key set in Cloudflare dashboard')
      .addText((text) =>
        text
          .setPlaceholder('your-secret-api-key')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('')
      .addButton((button) =>
        button
          .setButtonText('Test Connection')
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText('Testing...');

            try {
              const result = await this.plugin.api.checkStatus();
              new Notice(result.message);
            } finally {
              button.setDisabled(false);
              button.setButtonText('Test Connection');
            }
          })
      )
      .addButton((button) =>
        button
          .setButtonText('Setup Guide')
          .onClick(() => {
            window.open('https://github.com/CharlesSOo/Obsidian-share#readme');
          })
      );

    // Behavior
    containerEl.createEl('h3', { text: 'Behavior' });

    const detectedVaultName = this.plugin.getVaultSlug();

    new Setting(containerEl)
      .setName('Vault name override')
      .setDesc(`Used in URLs. Default: "${detectedVaultName}"`)
      .addText((text) =>
        text
          .setPlaceholder(detectedVaultName)
          .setValue(this.plugin.settings.vaultName)
          .onChange(async (value) => {
            this.plugin.settings.vaultName = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Include linked notes')
      .setDesc('Share notes linked via [[wikilinks]] together')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeLinkedNotes)
          .onChange(async (value) => {
            this.plugin.settings.includeLinkedNotes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Auto-sync edits')
      .setDesc('Re-upload shared notes when you edit them')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync ?? true)
          .onChange(async (value) => {
            this.plugin.settings.autoSync = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Sync delay (minutes)')
      .setDesc('Time between syncs while editing (1-30)')
      .addText((text) =>
        text
          .setPlaceholder('1')
          .setValue(String(this.plugin.settings.autoSyncDelay || 1))
          .onChange(async (value) => {
            const num = parseInt(value) || 1;
            this.plugin.settings.autoSyncDelay = Math.max(1, Math.min(30, num));
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Auto-delete after (days)')
      .setDesc('Delete shared notes after N days (0 = never)')
      .addText((text) =>
        text
          .setPlaceholder('0')
          .setValue(String(this.plugin.settings.autoDeleteDays || 0))
          .onChange(async (value) => {
            this.plugin.settings.autoDeleteDays = Math.max(0, parseInt(value) || 0);
            await this.plugin.saveSettings();
          })
      );
  }
}
