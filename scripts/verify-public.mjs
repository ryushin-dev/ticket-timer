import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './build.mjs';
export async function verifyPublic(directory = path.join(root, 'dist')) {
  const files = (await readdir(directory)).sort();
  if (JSON.stringify(files) !== JSON.stringify(['.nojekyll', 'index.html'])) {
    throw new Error('公開用フォルダにはindex.htmlと.nojekyllだけを置いてください');
  }
  const html = await readFile(path.join(directory, 'index.html'), 'utf8');
  const match = html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    if (!html.includes('function extractEntry') || !html.includes('id="practice-stage"') || /PRACTICE_(?:SCRIPT|STYLE|LOGO|MODEL_SCRIPT)|ENCRYPTED_PAYLOAD/.test(html)) throw new Error('公開用HTMLが正しく組み立てられていません');
    return { files, format: 'html', bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex') };
  }
  const payload = JSON.parse(match[1]);
  if (payload.version !== 1 || payload.iterations !== 600000 ||
      Buffer.from(payload.salt || '', 'base64').length !== 16 ||
      Buffer.from(payload.iv || '', 'base64').length !== 12 ||
      Buffer.from(payload.ciphertext || '', 'base64').length < 17) throw new Error('暗号化形式が正しくありません');
  for (const marker of ['function extractEntry', 'function readSettings', 'ringojamtour_shadows', 'performanceDateIso']) {
    if (html.includes(marker)) throw new Error('アプリの平文が混入しています。公開しません');
  }
  return { files, bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex') };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifyPublic(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
