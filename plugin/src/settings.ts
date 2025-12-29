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

    containerEl.createEl('h2', { text: 'Note Share Settings' });

    // Server Settings
    containerEl.createEl('h3', { text: 'Server' });

    new Setting(containerEl)
      .setName('Setup Guide')
      .setDesc('Need help setting up your Cloudflare Worker?')
      .addButton((button) =>
        button
          .setButtonText('Open Setup Guide')
          .onClick(() => {
            window.open('https://github.com/CharlesSOo/Obsidian-share/blob/main/worker/README.md');
          })
      );

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('Your Cloudflare Worker URL (e.g., https://notes.example.com)')
      .addText((text) =>
        text
          .setPlaceholder('https://notes.example.com')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.replace(/\/$/, '');
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Secret key for authenticating with your worker (set in Cloudflare dashboard)')
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
      .setName('Test Connection')
      .setDesc('Verify your worker is reachable and configured correctly')
      .addButton((button) =>
        button
          .setButtonText('Test Connection')
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText('Testing...');

            try {
              const result = await this.plugin.api.checkStatus();
              if (result.success) {
                new Notice(result.message);
              } else {
                new Notice(result.message);
              }
            } finally {
              button.setDisabled(false);
              button.setButtonText('Test Connection');
            }
          })
      );

    // Vault Settings
    containerEl.createEl('h3', { text: 'Vault' });

    const detectedVaultName = this.plugin.getVaultSlug();

    new Setting(containerEl)
      .setName('Vault Name')
      .setDesc(`Used in share URLs. Leave empty to use detected name: "${detectedVaultName}"`)
      .addText((text) =>
        text
          .setPlaceholder(detectedVaultName)
          .setValue(this.plugin.settings.vaultName)
          .onChange(async (value) => {
            this.plugin.settings.vaultName = value;
            await this.plugin.saveSettings();
          })
      );

    // Sharing Options
    containerEl.createEl('h3', { text: 'Sharing' });

    new Setting(containerEl)
      .setName('Include Linked Notes')
      .setDesc('Automatically share notes linked from the main note')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeLinkedNotes)
          .onChange(async (value) => {
            this.plugin.settings.includeLinkedNotes = value;
            await this.plugin.saveSettings();
          })
      );

    // Theme Info
    containerEl.createEl('h3', { text: 'Theme' });

    const themeInfo = containerEl.createEl('p', {
      cls: 'setting-item-description',
    });
    themeInfo.innerHTML = `
      Your current Obsidian theme colors are automatically detected and synced.<br>
      Use the <strong>Sync Theme</strong> button in the sidebar to update shared notes after changing themes.
    `;
  }
}
