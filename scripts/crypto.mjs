import { webcrypto } from 'node:crypto';
const subtle = webcrypto.subtle;
export const iterations = 600000;
const context = new TextEncoder().encode('ticket-pages-v1');
export async function derive(password, salt, usage) {
  const material = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
export async function encrypt(html, password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt, 'encrypt');
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context }, key, new TextEncoder().encode(html));
  return { version: 1, iterations, salt: Buffer.from(salt).toString('base64'), iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(encrypted).toString('base64') };
}
export async function decrypt(payload, password) {
  const key = await derive(password, Buffer.from(payload.salt, 'base64'), 'decrypt');
  const data = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(payload.iv, 'base64'), additionalData: context }, key, Buffer.from(payload.ciphertext, 'base64'));
  return new TextDecoder().decode(data);
}
