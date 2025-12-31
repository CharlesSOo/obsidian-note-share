import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { slugify, generateNoteHash } from '@obsidian-note-share/shared';
import { Env, ShareRequest, StoredNote, NoteIndex, ThemeSyncRequest, DualThemeSettings } from './types';
import { renderNote } from './render';

// Cache duration for images (1 year in seconds)
const IMAGE_CACHE_MAX_AGE = 31536000;

// In-memory theme cache with TTL
const themeCache = new Map<string, { theme: DualThemeSettings; expires: number }>();
const THEME_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getTheme(env: Env, vault: string): Promise<DualThemeSettings | undefined> {
  const cached = themeCache.get(vault);
  if (cached && cached.expires > Date.now()) {
    return cached.theme;
  }

  const themeObj = await env.NOTES.get(`${vault}/theme.json`);
  if (!themeObj) return undefined;

  const theme = await themeObj.json() as DualThemeSettings;
  themeCache.set(vault, { theme, expires: Date.now() + THEME_CACHE_TTL });
  return theme;
}

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for plugin requests
app.use('/api/*', cors());

// API Key authentication middleware
app.use('/api/*', async (c, next) => {
  const apiKey = c.req.header('X-API-Key');
  if (!apiKey || apiKey !== c.env.API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

// Health check endpoint - tests R2 connectivity
app.get('/api/status', async (c) => {
  try {
    // Test R2 bucket access with a simple list operation
    await c.env.NOTES.list({ limit: 1 });
    return c.json({
      status: 'ok',
      r2: true,
      version: '1.0.0',
    });
  } catch (e) {
    console.error('Status check error:', e);
    return c.json({
      status: 'error',
      error: 'R2 bucket not configured or inaccessible',
      r2: false,
      version: '1.0.0',
    }, 500);
  }
});

// Sync theme for a vault (supports light/dark modes)
app.put('/api/theme', async (c) => {
  try {
    const body = await c.req.json<ThemeSyncRequest>();

    if (!body.vault || !body.theme || !body.mode) {
      return c.json({ error: 'Missing vault, theme, or mode' }, 400);
    }

    // Read existing dual theme (if any)
    let dualTheme: DualThemeSettings = {};
    const existing = await c.env.NOTES.get(`${body.vault}/theme.json`);
    if (existing) {
      dualTheme = await existing.json();
    }

    // Merge incoming theme into the correct slot
    dualTheme[body.mode] = body.theme;
    dualTheme.updatedAt = new Date().toISOString();

    await c.env.NOTES.put(`${body.vault}/theme.json`, JSON.stringify(dualTheme));

    // Invalidate theme cache
    themeCache.delete(body.vault);

    return c.json({ success: true });
  } catch (e) {
    console.error('Theme sync error:', e);
    return c.json({ error: 'Failed to sync theme' }, 500);
  }
});

// Share a note
app.post('/api/share', async (c) => {
  try {
    const body = await c.req.json<ShareRequest>();

    if (!body.vault || !body.title || body.content === undefined) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const titleSlug = slugify(body.title);
    const hash = await generateNoteHash(body.vault, body.title);
    const linkedNotes: { titleSlug: string; hash: string }[] = [];

    // Store linked notes in parallel for better performance
    if (body.linkedNotes && body.linkedNotes.length > 0) {
      // First, compute all hashes and fetch existing notes in parallel
      const linkedNotesData = await Promise.all(
        body.linkedNotes.map(async (linked) => {
          const linkedTitleSlug = slugify(linked.title);
          const linkedHash = await generateNoteHash(body.vault, linked.title);
          const existingObj = await c.env.NOTES.get(`notes/${linkedTitleSlug}-${linkedHash}.json`);
          const existingNote = existingObj ? await existingObj.json() as StoredNote : null;
          return { linked, linkedTitleSlug, linkedHash, existingNote };
        })
      );

      // Then store all linked notes and update indexes in parallel
      await Promise.all(
        linkedNotesData.map(async ({ linked, linkedTitleSlug, linkedHash, existingNote }) => {
          const linkedCreatedAt = existingNote?.createdAt || new Date().toISOString();

          const linkedNote: StoredNote = {
            vault: body.vault,
            titleSlug: linkedTitleSlug,
            hash: linkedHash,
            title: linked.title,
            content: linked.content,
            createdAt: linkedCreatedAt,
            updatedAt: new Date().toISOString(),
            linkedNotes: [],
          };

          await c.env.NOTES.put(
            `notes/${linkedTitleSlug}-${linkedHash}.json`,
            JSON.stringify(linkedNote)
          );

          linkedNotes.push({ titleSlug: linkedTitleSlug, hash: linkedHash });

          // Add linked note to index
          await addToIndex(c.env.NOTES, body.vault, {
            titleSlug: linkedTitleSlug,
            hash: linkedHash,
            title: linked.title,
            createdAt: linkedNote.createdAt,
          });
        })
      );
    }

    // Check if main note already exists (preserve createdAt)
    let createdAt = new Date().toISOString();
    const existingNote = await c.env.NOTES.get(`notes/${titleSlug}-${hash}.json`);
    if (existingNote) {
      const existing: StoredNote = await existingNote.json();
      createdAt = existing.createdAt;
    }

    // Store main note
    const note: StoredNote = {
      vault: body.vault,
      titleSlug,
      hash,
      title: body.title,
      content: body.content,
      createdAt,
      updatedAt: new Date().toISOString(),
      linkedNotes,
      retentionDays: body.retentionDays || 0,
    };

    // Store note globally (vault info is inside the JSON)
    await c.env.NOTES.put(`notes/${titleSlug}-${hash}.json`, JSON.stringify(note));

    // Update vault-specific index for listing
    await addToIndex(c.env.NOTES, body.vault, {
      titleSlug,
      hash,
      title: body.title,
      createdAt: note.createdAt,
    });

    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    return c.json({
      url: `${baseUrl}/g/${body.vault}/${titleSlug}/${hash}`,
      titleSlug,
      hash,
    });
  } catch (e) {
    console.error('Share error:', e);
    return c.json({ error: 'Failed to share note' }, 500);
  }
});

// List all notes for a vault
app.get('/api/notes', async (c) => {
  try {
    const vault = c.req.query('vault');
    if (!vault) {
      return c.json({ error: 'Missing vault parameter' }, 400);
    }

    const indexObj = await c.env.NOTES.get(`${vault}/index.json`);
    if (!indexObj) {
      return c.json([]);
    }

    const index: NoteIndex = await indexObj.json();
    return c.json(index.notes);
  } catch (e) {
    console.error('List error:', e);
    return c.json({ error: 'Failed to list notes' }, 500);
  }
});

// Delete a note
app.delete('/api/notes/:vault/:titleSlug/:hash', async (c) => {
  try {
    const vault = c.req.param('vault');
    const titleSlug = c.req.param('titleSlug');
    const hash = c.req.param('hash');

    // Delete the note (stored globally)
    await c.env.NOTES.delete(`notes/${titleSlug}-${hash}.json`);

    // Update index
    await removeFromIndex(c.env.NOTES, vault, titleSlug, hash);

    return c.json({ success: true });
  } catch (e) {
    console.error('Delete error:', e);
    return c.json({ error: 'Failed to delete note' }, 500);
  }
});

// Upload an image for a note
app.post('/api/images/:noteHash', async (c) => {
  try {
    const noteHash = c.req.param('noteHash');
    const contentType = c.req.header('Content-Type') || 'application/octet-stream';
    const filename = c.req.header('X-Filename') || 'image';

    const body = await c.req.arrayBuffer();

    // Store image with note hash prefix for organization
    const key = `images/${noteHash}/${filename}`;
    await c.env.NOTES.put(key, body, {
      httpMetadata: { contentType },
    });

    const url = new URL(c.req.url);
    const imageUrl = `${url.protocol}//${url.host}/i/${noteHash}/${encodeURIComponent(filename)}`;

    return c.json({ url: imageUrl, key });
  } catch (e) {
    console.error('Image upload error:', e);
    return c.json({ error: 'Failed to upload image' }, 500);
  }
});

// Serve an image (public - no auth required)
app.get('/i/:noteHash/:filename', async (c) => {
  try {
    const noteHash = c.req.param('noteHash');
    const filename = c.req.param('filename');

    const obj = await c.env.NOTES.get(`images/${noteHash}/${filename}`);
    if (!obj) {
      return c.text('Not found', 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Cache-Control', `public, max-age=${IMAGE_CACHE_MAX_AGE}`);

    return new Response(obj.body, { headers });
  } catch (e) {
    console.error('Image serve error:', e);
    return c.text('Error', 500);
  }
});

// View a note (public - no auth required)
// URL format: /g/{vault}/{titleSlug}/{hash}
app.get('/g/:vault/:titleSlug/:hash', async (c) => {
  try {
    const vault = c.req.param('vault');
    const titleSlug = c.req.param('titleSlug');
    const hash = c.req.param('hash');

    const noteObj = await c.env.NOTES.get(`notes/${titleSlug}-${hash}.json`);
    if (!noteObj) {
      return c.html(render404(), 404);
    }

    const note: StoredNote = await noteObj.json();

    // Verify vault matches (security check)
    if (note.vault !== vault) {
      return c.html(render404(), 404);
    }

    // Get dual theme from cache or R2
    const theme = await getTheme(c.env, vault);

    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}/g/${vault}`;

    // Return with aggressive caching - notes are immutable by hash
    return new Response(renderNote(note, theme, baseUrl), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (e) {
    console.error('View error:', e);
    return c.html(render404(), 500);
  }
});

// Helper: Add to note index
async function addToIndex(
  bucket: R2Bucket,
  vault: string,
  note: { titleSlug: string; hash: string; title: string; createdAt: string }
): Promise<void> {
  let index: NoteIndex = { notes: [] };

  const indexObj = await bucket.get(`${vault}/index.json`);
  if (indexObj) {
    index = await indexObj.json();
  }

  // Remove existing entry if present (for updates)
  index.notes = index.notes.filter(
    (n) => !(n.titleSlug === note.titleSlug && n.hash === note.hash)
  );

  // Add new entry at the beginning
  index.notes.unshift(note);

  await bucket.put(`${vault}/index.json`, JSON.stringify(index));
}

// Helper: Remove from index
async function removeFromIndex(
  bucket: R2Bucket,
  vault: string,
  titleSlug: string,
  hash: string
): Promise<void> {
  const indexObj = await bucket.get(`${vault}/index.json`);
  if (!indexObj) return;

  const index: NoteIndex = await indexObj.json();
  index.notes = index.notes.filter(
    (n) => !(n.titleSlug === titleSlug && n.hash === hash)
  );

  await bucket.put(`${vault}/index.json`, JSON.stringify(index));
}

// 404 page
function render404(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Note Not Found</title>
  <style>
    body {
      margin: 0;
      padding: 40px 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1e1e1e;
      color: #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: calc(100vh - 80px);
    }
    .container {
      text-align: center;
    }
    h1 {
      font-size: 4em;
      margin: 0;
      color: #666;
    }
    p {
      color: #888;
      margin-top: 1em;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>404</h1>
    <p>This note doesn't exist or has been removed.</p>
  </div>
</body>
</html>`;
}

// Scheduled cleanup handler for auto-delete
async function cleanupExpiredNotes(env: Env): Promise<number> {
  const now = new Date();
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const notesList = await env.NOTES.list({ prefix: 'notes/', cursor });

    for (const object of notesList.objects) {
      const noteObj = await env.NOTES.get(object.key);
      if (!noteObj) continue;

      const note: StoredNote = await noteObj.json();

      // Skip if no retention set (0 = never delete)
      if (!note.retentionDays || note.retentionDays <= 0) continue;

      const noteDate = new Date(note.updatedAt || note.createdAt);
      const expiryDate = new Date(noteDate);
      expiryDate.setDate(expiryDate.getDate() + note.retentionDays);

      if (now > expiryDate) {
        // Delete note and associated images in parallel
        const imagesList = await env.NOTES.list({ prefix: `images/${note.hash}/` });
        await Promise.all([
          env.NOTES.delete(object.key),
          ...imagesList.objects.map(img => env.NOTES.delete(img.key)),
          removeFromIndex(env.NOTES, note.vault, note.titleSlug, note.hash),
        ]);

        console.log(`Deleted expired note: ${note.title} (${note.hash})`);
        deleted++;
      }
    }

    cursor = notesList.truncated ? notesList.cursor : undefined;
  } while (cursor);

  return deleted;
}

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log('Running auto-delete cleanup...');
    const deleted = await cleanupExpiredNotes(env);
    console.log(`Cleanup complete. Deleted ${deleted} notes.`);
  },
};
