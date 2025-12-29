# Obsidian Note Share

A self-hosted solution for sharing Obsidian notes via permanent URLs using Cloudflare Workers and R2.

## Architecture

- **Plugin** (`plugin/`): Obsidian plugin that handles sharing, auto-sync, and image uploads
- **Worker** (`src/`): Cloudflare Worker that stores notes in R2 and serves them as HTML

## Key Files

### Plugin
- `plugin/src/main.ts` - Main plugin logic, file watchers, image processing
- `plugin/src/api.ts` - API client for communicating with worker
- `plugin/src/types.ts` - TypeScript interfaces and settings
- `plugin/src/settings.ts` - Settings UI
- `plugin/src/sidebar.ts` - Sidebar view for managing shared notes

### Worker
- `src/index.ts` - Hono routes for API endpoints and note serving
- `src/render.ts` - Markdown rendering with Obsidian syntax support
- `src/types.ts` - TypeScript interfaces

## URL Format

Notes are served at: `/{vault}/{titleSlug}/{hash}`
Images are served at: `/i/{noteHash}/{filename}`

Hash is deterministic: `SHA-256(vault:title).slice(0,8)`

## Features

- **Auto-sync**: Automatically re-uploads shared notes when edited
- **Image upload**: Processes `![[image]]` embeds and uploads to R2
- **Theme sync**: Captures Obsidian theme colors for consistent rendering
- **Auto-delete**: Optional retention period (cron runs daily at midnight UTC)
- **Linked notes**: Optionally share linked notes together

## Development

```bash
# Plugin
cd plugin && npm run dev

# Worker (local)
npm run dev

# Deploy worker
git push  # CF Pages auto-deploys
```

## Settings

Plugin settings include:
- Server URL and API key
- Vault name override
- Include linked notes toggle
- Auto-sync toggle and delay
- Auto-delete days (0 = never)
