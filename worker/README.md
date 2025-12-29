# Obsidian Note Share - Worker

Cloudflare Worker backend for the Obsidian Note Share plugin. Stores and serves your shared notes.

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

### Step 2: Create R2 Storage Bucket

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **R2 Object Storage** in the sidebar
3. Click **Create bucket**
4. Name it exactly: `obsidian-shared-notes`
5. Click **Create bucket**

### Step 3: Set Your API Key

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Workers & Pages**
3. Click on your **obsidian-note-share** worker
4. Go to **Settings** > **Variables**
5. Under **Environment Variables**, click **Add variable**
6. Set:
   - Variable name: `API_KEY`
   - Value: Choose a secure secret (e.g., generate one at [randomkeygen.com](https://randomkeygen.com/))
7. Click **Encrypt** to make it a secret
8. Click **Save and deploy**

### Step 4: Get Your Worker URL

1. In your worker's overview page, find the URL
2. It looks like: `https://obsidian-note-share.YOUR-SUBDOMAIN.workers.dev`

### Step 5: Configure Obsidian Plugin

1. Open Obsidian Settings > Note Share
2. Enter your **Worker URL**
3. Enter your **API Key** (same value from Step 3)
4. Click **Test Connection** to verify

## Troubleshooting

### "R2 bucket not configured"
Make sure you created the bucket with the exact name `obsidian-shared-notes` in Step 2.

### "Invalid API key"
Make sure the API key in Obsidian matches exactly what you set in Cloudflare (Step 3).

### "Server not reachable"
Check that your Worker URL is correct and the worker is deployed.

## Custom Domain (Optional)

To use a custom domain like `notes.yourdomain.com`:

1. Go to your worker in Cloudflare Dashboard
2. Click **Settings** > **Triggers**
3. Add a **Custom Domain**
4. Enter your domain and follow the DNS setup

## Architecture

```
Obsidian Plugin → Cloudflare Worker → R2 Storage
                         ↓
                  Rendered HTML (public)
```

- Notes are stored in R2 as JSON
- Public URLs render notes as styled HTML
- Theme syncs from your Obsidian vault
