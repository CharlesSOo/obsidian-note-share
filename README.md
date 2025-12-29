# Obsidian Note Share

Share Obsidian notes via permanent links hosted on your own Cloudflare Worker.

## Setup

### Prerequisites
- Cloudflare account (free tier works)
- GitHub account

### 1. Deploy the Worker

Click to deploy this worker to your Cloudflare account:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CharlesSOo/Obsidian-share)

This will fork the repo and deploy the worker with R2 storage.

### 2. Set Your API Key

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**
2. Click your **obsidian-note-share** worker → **Settings** → **Variables and Secrets**
3. Add a new secret:
   - **Variable name**: `API_KEY`
   - **Value**: A secure password (generate at [randomkeygen.com](https://randomkeygen.com/))
4. Click **Deploy**

### 3. Get Your Worker URL

Find your URL in the worker's overview:
```
https://obsidian-note-share.YOUR-SUBDOMAIN.workers.dev
```

### 4. Install the Plugin

**Option A: BRAT (recommended)**
1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add beta plugin: `CharlesSOo/Obsidian-share`

**Option B: Manual**
1. Download `main.js`, `manifest.json`, and `styles.css` from the [plugin folder](./plugin)
2. Create folder: `.obsidian/plugins/obsidian-note-share/`
3. Copy files into that folder
4. Enable the plugin in Settings → Community Plugins

### 5. Configure the Plugin

1. **Settings** → **Note Share**
2. Enter your **Server URL** and **API Key**
3. Click **Test Connection**

## Usage

- **Right-click a note** → **Share Note** → Link copied instantly
- **Sidebar** → View all shared notes, copy links, or delete

## Troubleshooting

| Error | Fix |
|-------|-----|
| Server not reachable | Include `https://` in the URL |
| Invalid API key | Ensure the key matches exactly; variable must be `API_KEY` |
| R2 bucket not configured | Create bucket named `obsidian-shared-notes` in R2 dashboard |

## Custom Domain (Optional)

1. Worker → **Settings** → **Domains & Routes**
2. Add your domain (auto-configured if on Cloudflare DNS)
