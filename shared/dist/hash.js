import { HASH_BYTES } from './constants';
/**
 * Generate deterministic hash from vault + title
 * Same note always gets same URL, re-sharing updates content
 */
export async function generateNoteHash(vault, title) {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${vault}:${title}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray
        .slice(0, HASH_BYTES)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
