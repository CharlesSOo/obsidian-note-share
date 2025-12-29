# Obsidian Note Share

Share Obsidian notes via permanent links hosted on Cloudflare.

## Structure

```
obsidian-note-share/
├── plugin/     # Obsidian plugin
└── worker/     # Cloudflare Worker (API + rendering)
```

## Setup

### 1. Cloudflare Worker

```bash
cd worker
npm install

# Create R2 bucket in Cloudflare dashboard:
# - Name: obsidian-shared-notes

# Set your API key
wrangler secret put API_KEY

# Deploy
npm run deploy
```

After deploying, note your worker URL (e.g., `https://obsidian-note-share.your-account.workers.dev`).

For a custom domain, configure it in Cloudflare dashboard under Workers > your worker > Settings > Domains & Routes.

### 2. Obsidian Plugin

```bash
cd plugin
npm install
npm run build
```

Copy the following files to your vault's `.obsidian/plugins/obsidian-note-share/` folder:
- `main.js`
- `manifest.json`
- `styles.css`

Or for development:
```bash
# Symlink to your vault
ln -s $(pwd) /path/to/vault/.obsidian/plugins/obsidian-note-share
npm run dev  # Auto-rebuild on changes
```

### 3. Configure Plugin

1. Enable the plugin in Obsidian settings
2. Go to Note Share settings:
   - **Server URL**: Your worker URL
   - **API Key**: Same key you set with `wrangler secret`
3. Customize URL style and appearance settings

## Usage

- **Right-click a note** → "Share Note" → Link copied to clipboard
- **Click the share icon** in the left ribbon to view shared notes
- **Delete** shared notes from the sidebar panel
