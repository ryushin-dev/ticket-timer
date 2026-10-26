import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encrypt, decrypt } from '../scripts/crypto.mjs';
import { assemble, build, buildPlain } from '../scripts/build.mjs';
import { verifyPublic } from '../scripts/verify-public.mjs';

test('正しいパスワードのみ復号でき、改ざんも拒否する', async () => {
  const password = 'test-only-not-for-publishing';
  const payload = await encrypt('<html>private content</html>', password);
  assert.equal(await decrypt(payload, password), '<html>private content</html>');
  await assert.rejects(decrypt(payload, 'incorrect-password'));
  const bytes = Buffer.from(payload.ciphertext, 'base64'); bytes[0] ^= 1;
  await assert.rejects(decrypt({ ...payload, ciphertext: bytes.toString('base64') }, password));
});
test('毎回saltとIVが変わる', async () => {
  const [a, b] = await Promise.all([encrypt('same', 'test-password-one'), encrypt('same', 'test-password-one')]);
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.iv, b.iv); assert.notEqual(a.ciphertext, b.ciphertext);
});
test('公開物にアプリの平文・パスワードを含めない', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ticket-pages-test-'));
  try {
    const password = 'test-only-build-password';
    await build(password, directory);
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.ok(!html.includes(password)); assert.ok(!html.includes('ringojamtour_shadows'));
    assert.ok(!html.includes('function extractEntry')); assert.ok(!html.includes('receptionName'));
    const data = JSON.parse(html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(await decrypt(data, password), await assemble());
    await readFile(path.join(directory, '.nojekyll'));
    const verified = await verifyPublic(directory);
    assert.ok(verified.bytes > 1000); assert.match(verified.sha256, /^[a-f0-9]{64}$/);
    await assert.rejects(build('short', directory), /12文字/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('平文HTMLは公開検証で拒否する', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ticket-pages-plain-'));
  try {
    await buildPlain(directory);
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.equal(html, await assemble());
    assert.ok(!html.includes('<script id="payload"'));
    await assert.rejects(verifyPublic(directory), /暗号化されていません/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
