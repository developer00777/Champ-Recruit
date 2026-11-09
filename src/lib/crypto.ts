/**
 * AES-GCM encryption for channel tokens and webhook secrets.
 * Format: v{keyVersion}.{base64(iv)}.{base64(ciphertext)}
 * Rotation: add TOKEN_ENC_KEY_V2, bump CURRENT_KEY_VERSION, re-encrypt lazily on read.
 */
const CURRENT_KEY_VERSION = 1;

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function importKey(rawB64: string) {
  if (!rawB64) throw new Error('TOKEN_ENC_KEY is not set');
  const raw = unb64(rawB64);
  if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes (base64)');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(keyB64: string, plaintext: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));
  return `v${CURRENT_KEY_VERSION}.${b64(iv)}.${b64(ct)}`;
}

export async function decrypt(keyB64: string, payload: string): Promise<string> {
  const [ver, ivB64, ctB64] = payload.split('.');
  if (ver !== `v${CURRENT_KEY_VERSION}` || !ivB64 || !ctB64) throw new Error('Unsupported ciphertext version');
  const key = await importKey(keyB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(ctB64));
  return new TextDecoder().decode(pt);
}
