import { TFile, App } from 'obsidian';
import { generateNoteHash } from '@obsidian-note-share/shared';
import type { NoteShareAPI } from './api';

// Regex for Obsidian-style image embeds: ![[path]] or ![[path|alias]]
export const OBSIDIAN_EMBED_REGEX = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gi;

// Markdown-style image regex: ![alt](path.ext)
export const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+\.(png|jpg|jpeg|gif|webp|svg))\)/gi;

// Supported image extensions
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];

// WebP compression quality (0-1)
export const WEBP_QUALITY = 0.85;

// Max concurrent uploads/operations
export const MAX_CONCURRENT = 20;

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
 */
export async function uploadImageFile(
  app: App,
  api: NoteShareAPI,
  imageFile: TFile,
  noteHash: string
): Promise<string | undefined> {
  try {
    console.log(`[NoteShare] Uploading image: ${imageFile.path}`);
    const imageData = await app.vault.readBinary(imageFile);
    const ext = imageFile.extension.toLowerCase();

    // Skip WebP conversion for SVGs (already optimized vectors)
    if (ext === 'svg') {
      const result = await api.uploadImage(noteHash, imageFile.name, imageData, 'image/svg+xml');
      console.log(`[NoteShare] SVG uploaded: ${result.url}`);
      return result.url;
    }

    // Convert to WebP for all other image formats
    const webpData = await convertToWebP(imageData);
    const webpFilename = imageFile.basename + '.webp';

    const result = await api.uploadImage(noteHash, webpFilename, webpData, 'image/webp');
    console.log(`[NoteShare] Image converted to WebP and uploaded: ${result.url}`);
    return result.url;
  } catch (e) {
    console.error(`[NoteShare] Failed to upload image ${imageFile.path}:`, e);
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

  // Build upload tasks for Obsidian-style embeds
  type MaybeUploadResult = UploadResult | undefined;
  const obsidianTasks: Promise<MaybeUploadResult>[] = [];

  for (const match of obsidianMatches) {
    const embedPath = match[1];
    const alias = match[2];
    const originalText = match[0];

    const resolvedFile = app.metadataCache.getFirstLinkpathDest(embedPath, file.path);

    if (!resolvedFile || !(resolvedFile instanceof TFile)) {
      console.log(`[NoteShare] Could not resolve: ${embedPath}`);
      continue;
    }

    if (!IMAGE_EXTENSIONS.includes(resolvedFile.extension.toLowerCase())) {
      console.log(`[NoteShare] Not an image: ${embedPath}`);
      continue;
    }

    // Queue upload task
    obsidianTasks.push(
      sem.run(async () => {
        console.log(`[NoteShare] Uploading: ${resolvedFile.path}`);
        const imageUrl = await uploadImageFile(app, api, resolvedFile, noteHash);
        if (imageUrl) {
          const altText = alias || resolvedFile.basename;
          return { original: originalText, replacement: `![${altText}](${imageUrl})` };
        }
        return undefined;
      })
    );
  }

  // Build upload tasks for markdown-style images
  const markdownTasks: Promise<MaybeUploadResult>[] = [];

  for (const match of markdownMatches) {
    const fullMatch = match[0];
    const alt = match[1];
    const imagePath = match[2];

    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) continue;

    const imageFile = app.metadataCache.getFirstLinkpathDest(imagePath, file.path);

    if (imageFile instanceof TFile) {
      markdownTasks.push(
        sem.run(async () => {
          const imageUrl = await uploadImageFile(app, api, imageFile, noteHash);
          if (imageUrl) {
            return { original: fullMatch, replacement: `![${alt}](${imageUrl})` };
          }
          return undefined;
        })
      );
    }
  }

  // Run all uploads in parallel (semaphore limits concurrency)
  const allResults = await Promise.all([...obsidianTasks, ...markdownTasks]);

  // Apply all replacements
  for (const result of allResults) {
    if (result) {
      processedContent = processedContent.replaceAll(result.original, result.replacement);
    }
  }

  // Clean up any remaining image embeds that couldn't be processed
  // This prevents them from breaking internal link processing on the server
  processedContent = processedContent.replace(
    OBSIDIAN_EMBED_REGEX,
    (match, path, alias) => `[Image: ${alias || path}]`
  );

  return processedContent;
}
