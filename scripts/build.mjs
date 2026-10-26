import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encrypt } from './crypto.mjs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function assemble() {
  const [template, core, app, practiceHtml, practiceCss, practiceModel, practiceScript, logo, check, countries, queueArt] = await Promise.all(['app.html', 'core.js', 'app.js', 'practice.html', 'practice.css', 'practice-model.js', 'practice.js', 'assets/tixplus-logo.svg', 'assets/queue-check.svg', 'assets/practice-countries.json', 'assets/queue-art.svg'].map(name => readFile(path.join(root, 'src', name), 'utf8')));
  const image = svg => {
    if (/<script\b|<foreignObject\b|\bon\w+\s*=|(?:xlink:)?href\s*=\s*["'](?:https?:|\/\/|javascript:)/i.test(svg)) throw new Error('練習用画像に外部参照・スクリプトが含まれています');
    return JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  };
  const countryOptions = JSON.parse(countries).map(([value, label]) => {
    if (!/^\d*$/.test(value) || /[<>"&]/.test(label)) throw new Error('国選択の形式が無効です');
    return `<option value="${value}">${label}</option>`;
  }).join('');
  const referencePages = await readFile(path.join(root, 'src/assets/shadows-reference/pages.json'), 'utf8');
  const practice = practiceScript.replace('/* PRACTICE_REFERENCE_PAGES */', () => JSON.stringify(JSON.parse(referencePages)).replace(/</g, '\\u003c')).replace('/* PRACTICE_LOGO */', () => image(logo)).replace('/* PRACTICE_CHECK_ICON */', () => image(check)).replace('/* PRACTICE_COUNTRY_OPTIONS */', () => JSON.stringify(countryOptions)).replace('/* PRACTICE_QUEUE_ART */', () => image(queueArt));
  return template.replace('/* CORE_SCRIPT */', () => core).replace('/* APP_SCRIPT */', () => app)
    .replace('/* PRACTICE_STYLE */', () => practiceCss).replace('<!-- PRACTICE_PANEL -->', () => practiceHtml)
    .replace('/* PRACTICE_MODEL_SCRIPT */', () => practiceModel).replace('/* PRACTICE_SCRIPT */', () => practice);
}
export async function build(password, output = path.join(root, 'dist')) {
  if (password.length < 12) throw new Error('パスワードは12文字以上にしてください。長いパスフレーズを使えます。');
  const payload = await encrypt(await assemble(), password);
  const template = await readFile(path.join(root, 'src', 'lock.html'), 'utf8');
  const html = template.replace('/* ENCRYPTED_PAYLOAD */', () => JSON.stringify(payload));
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'index.html'), html);
  await writeFile(path.join(output, '.nojekyll'), '');
  return output;
}
export async function buildPlain(output = path.join(root, 'dist')) {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'index.html'), await assemble());
  await writeFile(path.join(output, '.nojekyll'), '');
  return output;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const prompt = createInterface({ input: process.stdin, output: muted, terminal: Boolean(process.stdin.isTTY) });
    let password;
    try {
      process.stderr.write('公開用パスワード: ');
      password = await prompt.question('');
      process.stderr.write('\n確認用パスワード: ');
      const confirmation = await prompt.question('');
      process.stderr.write('\n');
      if (password !== confirmation) throw new Error('パスワードが一致しません。');
    } finally { prompt.close(); }
    const output = await build(password);
    await writeFile(path.join(root, 'index.html'), await readFile(path.join(output, 'index.html')));
    await writeFile(path.join(root, '.nojekyll'), '');
    console.log(`公開用HTMLを生成しました: ${output}（GitHub Pages用にルートにも配置済み）`);
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
