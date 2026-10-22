import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root, assemble } from './build.mjs';
const source = process.argv.includes('--source');
const dirFlag = process.argv.indexOf('--dir');
const directory = dirFlag >= 0 ? path.resolve(process.argv[dirFlag + 1]) : path.join(root, 'dist');
const port = Number(process.env.PORT || 8787);
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!['/', '/index.html'].includes(pathname)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const html = source ? await assemble() : await readFile(path.join(directory, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html);
  } catch { res.writeHead(404); res.end('公開版は先にnpm run buildを実行してください。'); }
});
server.on('error', error => { console.error(`プレビューを起動できません: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Local preview: http://localhost:${port} (${source ? '暗号化前・ローカル専用' : '暗号化版'})`));
