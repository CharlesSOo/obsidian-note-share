import { TFile, App, Notice } from 'obsidian';
import { generateNoteHash } from '@obsidian-note-share/shared';
import type { NoteShareAPI } from './api';

// Regex for Obsidian-style image embeds: ![[path]] or ![[path|alias]]
export const OBSIDIAN_EMBED_REGEX = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gi;

// Markdown-style image regex: ![alt](path.ext)
export const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+\.(png|jpg|jpeg|gif|webp|svg|mp4|mov|webm|m4v))\)/gi;

// Supported image extensions
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];

// Supported video extensions
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v'];

// Max upload size (Cloudflare Workers cap is 100 MB; leave headroom)
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

function videoContentType(ext: string): string {
  switch (ext) {
    case 'mp4':
    case 'm4v': return 'video/mp4';
    case 'mov': return 'video/quicktime';
    case 'webm': return 'video/webm';
    default: return 'application/octet-stream';
  }
}

// WebP compression quality (0-1)
export const WEBP_QUALITY = 0.85;

// Max concurrent uploads/operations
export const MAX_CONCURRENT = 20;

// WebP conversion cache: path -> { mtime, webpData }
const imageCache = new Map<string, { mtime: number; webpData: ArrayBuffer }>();

/**
 * Result of an image upload operation
 */
interface UploadResult {
  original: string;
  replacement: string;
}

/**
 * Semaphore for limiting concurrent operations
 */
export class Semaphore {
  private running = 0;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    if (this.running < MAX_CONCURRENT) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.running++;
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Convert image data to WebP format
 */
export async function convertToWebP(imageData: ArrayBuffer): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([imageData]);
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob(
        (webpBlob) => {
          if (!webpBlob) {
            reject(new Error('Failed to convert to WebP'));
            return;
          }
          webpBlob.arrayBuffer().then(resolve).catch(reject);
        },
        'image/webp',
        WEBP_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Upload a single image file and return its URL
 * Uses caching to avoid re-converting unchanged images to WebP
 */
export async function uploadImageFile(
  app: App,
  api: NoteShareAPI,
  imageFile: TFile,
  noteHash: string
): Promise<string | undefined> {
  try {
    console.log(`[NoteShare] Uploading image: ${imageFile.path}`);
    const ext = imageFile.extension.toLowerCase();

    // Skip WebP conversion for SVGs (already optimized vectors)
    if (ext === 'svg') {
      const imageData = await app.vault.readBinary(imageFile);
      const result = await api.uploadImage(noteHash, imageFile.name, imageData, 'image/svg+xml');
      console.log(`[NoteShare] SVG uploaded: ${result.url}`);
      return result.url;
    }

    // Check cache for WebP conversion
    const fileStat = await app.vault.adapter.stat(imageFile.path);
    const mtime = fileStat?.mtime || 0;
    const cached = imageCache.get(imageFile.path);

    let webpData: ArrayBuffer;
    if (cached && cached.mtime === mtime) {
      // Use cached WebP data
      console.log(`[NoteShare] Using cached WebP: ${imageFile.path}`);
      webpData = cached.webpData;
    } else {
      // Convert and cache
      const imageData = await app.vault.readBinary(imageFile);
      webpData = await convertToWebP(imageData);
      imageCache.set(imageFile.path, { mtime, webpData });
      console.log(`[NoteShare] Converted and cached WebP: ${imageFile.path}`);
    }

    const webpFilename = imageFile.basename + '.webp';
    const result = await api.uploadImage(noteHash, webpFilename, webpData, 'image/webp');
    console.log(`[NoteShare] Image uploaded: ${result.url}`);
    return result.url;
  } catch (e) {
    console.error(`[NoteShare] Failed to upload image ${imageFile.path}:`, e);
    return undefined;
  }
}

/**
 * Upload a video file as-is (no conversion). Returns an HTML <video> tag string,
 * since markdown image syntax doesn't render videos.
 */
export async function uploadVideoFile(
  app: App,
  api: NoteShareAPI,
  videoFile: TFile,
  noteHash: string
): Promise<string | undefined> {
  try {
    const stat = await app.vault.adapter.stat(videoFile.path);
    if (stat && stat.size > MAX_UPLOAD_BYTES) {
      const sizeMb = (stat.size / 1024 / 1024).toFixed(1);
      const limitMb = MAX_UPLOAD_BYTES / 1024 / 1024;
      const msg = `Video too large: ${videoFile.name} is ${sizeMb} MB (max ${limitMb} MB)`;
      console.warn(`[NoteShare] ${msg}`);
      new Notice(msg, 8000);
      return undefined;
    }

    const ext = videoFile.extension.toLowerCase();
    const data = await app.vault.readBinary(videoFile);
    const result = await api.uploadImage(noteHash, videoFile.name, data, videoContentType(ext));
    console.log(`[NoteShare] Video uploaded: ${result.url}`);
    return result.url;
  } catch (e) {
    console.error(`[NoteShare] Failed to upload video ${videoFile.path}:`, e);
    return undefined;
  }
}

/**
 * Process all images in content and upload them
 */
export async function processImages(
  app: App,
  api: NoteShareAPI,
  file: TFile,
  content: string,
  vaultSlug: string,
  semaphore?: Semaphore
): Promise<string> {
  const sem = semaphore ?? new Semaphore();

  // Generate hash for this note (same logic as server)
  const title = file.basename;
  const noteHash = await generateNoteHash(vaultSlug, title);

  let processedContent = content;

  // Match ALL Obsidian-style embeds: ![[path]] or ![[path|alias]]
  const obsidianMatches = [...content.matchAll(OBSIDIAN_EMBED_REGEX)];

  // Match markdown-style images: ![alt](path.png)
  const markdownMatches = [...content.matchAll(MARKDOWN_IMAGE_REGEX)];

  // Helper to create upload task (handles both images and videos)
  const createUploadTask = (
    mediaFile: TFile,
    original: string,
    alt: string
  ): Promise<UploadResult | undefined> =>
    sem.run(async () => {
      const ext = mediaFile.extension.toLowerCase();
      if (VIDEO_EXTENSIONS.includes(ext)) {
        const url = await uploadVideoFile(app, api, mediaFile, noteHash);
        return url ? { original, replacement: `<video src="${url}" controls playsinline preload="metadata" style="max-width:100%"></video>` } : undefined;
      }
      const url = await uploadImageFile(app, api, mediaFile, noteHash);
      return url ? { original, replacement: `![${alt}](${url})` } : undefined;
    });

  // Build upload tasks
  const tasks: Promise<UploadResult | undefined>[] = [];

  // Process Obsidian-style embeds
  for (const match of obsidianMatches) {
    const [originalText, embedPath, alias] = match;
    const resolvedFile = app.metadataCache.getFirstLinkpathDest(embedPath, file.path);

    if (!(resolvedFile instanceof TFile)) continue;
    const ext = resolvedFile.extension.toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext) && !VIDEO_EXTENSIONS.includes(ext)) continue;

    tasks.push(createUploadTask(resolvedFile, originalText, alias || resolvedFile.basename));
  }

  // Process markdown-style images
  for (const match of markdownMatches) {
    const [fullMatch, alt, imagePath] = match;
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) continue;

    const imageFile = app.metadataCache.getFirstLinkpathDest(imagePath, file.path);
    if (imageFile instanceof TFile) {
      tasks.push(createUploadTask(imageFile, fullMatch, alt));
    }
  }

  // Run all uploads in parallel and build replacement map
  const results = await Promise.all(tasks);
  const replacements = new Map<string, string>();
  for (const r of results) {
    if (r) replacements.set(r.original, r.replacement);
  }

  // Single-pass replacement using regex
  if (replacements.size > 0) {
    const pattern = new RegExp(
      [...replacements.keys()].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'g'
    );
    processedContent = processedContent.replace(pattern, m => replacements.get(m) || m);
  }

  // Clean up any remaining embeds that couldn't be processed
  // This prevents them from breaking internal link processing on the server
  processedContent = processedContent.replace(
    OBSIDIAN_EMBED_REGEX,
    (match, path, alias) => {
      const ext = (path.split('.').pop() || '').toLowerCase();
      const label = VIDEO_EXTENSIONS.includes(ext) ? 'Video' : 'Image';
      return `[${label}: ${alias || path}]`;
    }
  );

  return processedContent;
}
