export type MediaKey = 'avatar' | 'cover' | 'background';

const limits: Record<MediaKey, number> = { avatar: 2, cover: 6, background: 8 };
const urls = new Map<string, string>();
const storageKey = (key: MediaKey, version?: string) => version ? `${key}@${version}` : key;
let opening: Promise<IDBDatabase | null> | null = null;

export class ImageError extends Error {
  constructor(public reason: 'size' | 'decode', public maxMb = 0) { super(reason); }
}

function database(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (!('indexedDB' in window)) return resolve(null);
      const request = indexedDB.open('gf-profile', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('media')) request.result.createObjectStore('media');
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); opening = null; };
        resolve(request.result);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}

function transaction<T>(key: MediaKey, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise(async (resolve) => {
    try {
      const db = await database();
      if (!db) return resolve(null);
      const tx = db.transaction('media', mode);
      const request = action(tx.objectStore('media'));
      let result: T | null = null;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => resolve(null);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}

function revoke(key: string) {
  const url = urls.get(key);
  if (url) URL.revokeObjectURL(url);
  urls.delete(key);
}

export async function putMedia(key: MediaKey, blob: Blob): Promise<boolean> {
  try {
    const result = await transaction(key, 'readwrite', (store) => store.put(blob, key));
    if (result === null) return false;
    revoke(key);
    return true;
  } catch { return false; }
}

export async function getMedia(key: MediaKey, version?: string): Promise<Blob | null> {
  try {
    const result = await transaction(key, 'readonly', (store) => store.get(storageKey(key, version)));
    return result instanceof Blob ? result : null;
  } catch { return null; }
}

export async function deleteMedia(key: MediaKey, version?: string): Promise<boolean> {
  const id = storageKey(key, version);
  try {
    const result = await transaction(key, 'readwrite', (store) => store.delete(id));
    if (result === null) return false;
    revoke(id);
    return true;
  } catch { return false; }
}

export async function commitMedia(changes: Partial<Record<MediaKey, Blob>>, version: string): Promise<boolean> {
  const entries = Object.entries(changes) as [MediaKey, Blob][];
  if (!entries.length) return true;
  const db = await database();
  if (!db) return false;
  try {
    const tx = db.transaction('media', 'readwrite');
    const committed = await new Promise<boolean>((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
      try {
        const media = tx.objectStore('media');
        for (const [key, blob] of entries) media.put(blob, storageKey(key, version));
      } catch { tx.abort(); }
    });
    return committed;
  } catch { return false; }
}

export async function mediaUrl(key: MediaKey, version?: string): Promise<string | null> {
  try {
    const id = storageKey(key, version);
    const cached = urls.get(id);
    if (cached) return cached;
    const blob = await getMedia(key, version);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
  } catch { return null; }
}

function animatedWebp(bytes: Uint8Array) {
  if (bytes.length < 21 || String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') return false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const tag = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const length = (bytes[offset + 4] | bytes[offset + 5] << 8 | bytes[offset + 6] << 16 | bytes[offset + 7] << 24) >>> 0;
    if (tag === 'ANIM' || tag === 'ANMF') return true;
    if (tag === 'VP8X' && offset + 9 <= bytes.length && (bytes[offset + 8] & 2)) return true;
    offset += 8 + length + (length & 1);
  }
  return false;
}

async function decoded(blob: Blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      if (!bitmap.width || !bitmap.height) throw new Error();
      return bitmap;
    } catch { /* Некоторые браузеры декодируют GIF только через Image. */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

function dimensions(image: ImageBitmap | HTMLImageElement) {
  return typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap ? [image.width, image.height] : [image.naturalWidth, image.naturalHeight];
}

export async function prepareImage(file: File, kind: MediaKey): Promise<Blob> {
  try {
    if (!['image/gif', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new ImageError('decode');
    const animated = file.type === 'image/gif' || file.type === 'image/webp' && animatedWebp(new Uint8Array(await file.arrayBuffer()));
    if (animated && file.size > limits[kind] * 1024 * 1024) throw new ImageError('size', limits[kind]);
    const image = await decoded(file);
    if (animated) {
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
      return file;
    }
    const [width, height] = dimensions(image);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new ImageError('decode');
    if (kind === 'background') {
      const ratio = Math.min(1, 2560 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } else {
      const aspect = kind === 'avatar' ? 1 : 4;
      const sourceWidth = Math.min(width, height * aspect), sourceHeight = sourceWidth / aspect;
      const targetWidth = kind === 'avatar' ? 256 : Math.min(1600, Math.round(sourceWidth));
      canvas.width = targetWidth;
      canvas.height = kind === 'avatar' ? 256 : Math.max(1, Math.round(targetWidth / 4));
      context.drawImage(image, (width - sourceWidth) / 2, (height - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    }
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
    const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, .86));
    let blob = await encode('image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg');
    if (!blob) throw new ImageError('decode');
    if (blob.size > limits[kind] * 1024 * 1024) throw new ImageError('size', limits[kind]);
    return blob;
  } catch (error) { throw error instanceof ImageError ? error : new ImageError('decode'); }
}

export async function dataUrlToBlob(data: string, kind: MediaKey): Promise<Blob | null> {
  try {
    const match = /^data:(image\/(?:gif|png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
    if (!match || match[2].length > Math.ceil(limits[kind] * 1024 * 1024 * 4 / 3) + 4) return null;
    const binary = atob(match[2]);
    if (binary.length > limits[kind] * 1024 * 1024) return null;
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: match[1] });
    const image = await decoded(blob);
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
    return blob;
  } catch { return null; }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error());
      reader.onerror = () => reject(new Error());
      reader.readAsDataURL(blob);
    } catch { reject(new Error()); }
  });
}
