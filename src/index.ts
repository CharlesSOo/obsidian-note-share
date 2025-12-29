import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, ShareRequest, StoredNote, NoteIndex, ThemeSyncRequest, ThemeSettings } from './types';
import { renderNote } from './render';

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

// Helper: Generate slug from title
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Helper: Generate short hash
async function generateHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text + Date.now() + Math.random());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Sync theme for a vault
app.put('/api/theme', async (c) => {
  try {
    const body = await c.req.json<ThemeSyncRequest>();

    if (!body.vault || !body.theme) {
      return c.json({ error: 'Missing vault or theme' }, 400);
    }

    const theme: ThemeSettings = {
      ...body.theme,
      updatedAt: new Date().toISOString(),
    };

    await c.env.NOTES.put(`${body.vault}/theme.json`, JSON.stringify(theme));

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
    const hash = await generateHash(body.title);
    const linkedNotes: { titleSlug: string; hash: string }[] = [];

    // Store linked notes first
    if (body.linkedNotes && body.linkedNotes.length > 0) {
      for (const linked of body.linkedNotes) {
        const linkedTitleSlug = slugify(linked.title);
        const linkedHash = await generateHash(linked.title);

        const linkedNote: StoredNote = {
          vault: body.vault,
          titleSlug: linkedTitleSlug,
          hash: linkedHash,
          title: linked.title,
          content: linked.content,
          createdAt: new Date().toISOString(),
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
      }
    }

    // Store main note
    const note: StoredNote = {
      vault: body.vault,
      titleSlug,
      hash,
      title: body.title,
      content: body.content,
      createdAt: new Date().toISOString(),
      linkedNotes,
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
      url: `${baseUrl}/g/${titleSlug}/${hash}`,
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

// View a note (public - no auth required)
app.get('/g/:titleSlug/:hash', async (c) => {
  try {
    const titleSlug = c.req.param('titleSlug');
    const hash = c.req.param('hash');

    const noteObj = await c.env.NOTES.get(`notes/${titleSlug}-${hash}.json`);
    if (!noteObj) {
      return c.html(render404(), 404);
    }

    const note: StoredNote = await noteObj.json();

    // Get theme from the note's vault
    let theme: ThemeSettings | null = null;
    const themeObj = await c.env.NOTES.get(`${note.vault}/theme.json`);
    if (themeObj) {
      theme = await themeObj.json();
    }

    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}/g`;

    return c.html(renderNote(note, theme, baseUrl));
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

export default app;
