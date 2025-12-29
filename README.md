# Obsidian Note Share

Share Obsidian notes via permanent links hosted on your own Cloudflare Worker.

## Quick Setup

### Prerequisites
- GitHub account
- Cloudflare account (free tier works)

### Step 1: Deploy the Worker

Click the button below to deploy this worker to your Cloudflare account:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CharlesSOo/Obsidian-share)

This will:
1. Fork this repository to your GitHub
2. Deploy the worker to your Cloudflare account
3. Create the R2 storage bucket automatically

### Step 2: Set Your API Key

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**
2. Click on your **obsidian-note-share** worker
3. Go to **Settings** → **Variables and Secrets**
4. Click **+ Add**
5. Set:
   - **Type**: Secret
   - **Variable name**: `API_KEY`
   - **Value**: A secure secret (generate one at [randomkeygen.com](https://randomkeygen.com/))
6. Click **Add variable**, then **Deploy**

### Step 3: Get Your Worker URL

In your worker's overview page, find the URL:
```
https://obsidian-note-share.YOUR-SUBDOMAIN.workers.dev
```

### Step 4: Configure Obsidian Plugin

1. Install the **Note Share** plugin in Obsidian
2. Open **Settings** → **Note Share**
3. Enter your **Server URL** (include `https://`)
4. Enter your **API Key** (same value from Step 2)
5. Click **Test Connection** to verify

## Usage

- **Right-click** a note → **Share Note** → Link copied to clipboard
- **Sidebar** → View/manage all shared notes, sync theme

## Troubleshooting

### "Server not reachable"
- Make sure the URL includes `https://`
- Check that your worker is deployed

### "Invalid API key"
- Make sure the API key in Obsidian matches exactly what you set in Cloudflare
- Verify the variable name is exactly `API_KEY`

### "R2 bucket not configured"
The deploy button should create this automatically. If not:
1. Go to Cloudflare Dashboard → **R2 Object Storage**
2. Create a bucket named exactly: `obsidian-shared-notes`

## Custom Domain (Optional)

To use a custom domain like `share.yourdomain.com`:

1. Go to your worker → **Settings** → **Domains & Routes**
2. Add your custom domain
3. DNS will be configured automatically if your domain is on Cloudflare

## How It Works

```
Obsidian Plugin → Cloudflare Worker → R2 Storage
                         ↓
                  Rendered HTML (public URLs)
```

- Notes stored privately in your R2 bucket
- Shared via URLs like: `https://your-worker.dev/g/vault/note-title/hash`
- Your Obsidian theme colors sync automatically
