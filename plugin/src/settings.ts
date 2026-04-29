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
      .setName('Verify connection')
      .setDesc('Test that your server URL and API key are configured correctly')
      .addButton((button) =>
        button
          .setButtonText('Test Connection')
          .setCta()
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

    new Setting(containerEl)
      .setName('Theme')
      .setDesc('Sync your Obsidian theme colors to shared notes')
      .addButton((button) =>
        button
          .setButtonText('Sync Theme')
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText('Syncing...');

            try {
              await this.plugin.syncTheme();
            } finally {
              button.setDisabled(false);
              button.setButtonText('Sync Theme');
            }
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
