// ツアーページの見出しとボタンのタグを使って、公式受付ページを探します。
function decode(text) {
  return text.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    const key = entity.slice(1, -1).toLowerCase();
    if (named[key]) return named[key];
    const value = key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return value <= 0x10ffff ? String.fromCodePoint(value) : entity;
  });
}
function text(html) {
  return decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function normalize(value) {
  return value.normalize('NFKC').replace(/\s+/g, '');
}
function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}
function hasClass(attrs, name) {
  return (attrs.class || '').split(/\s+/).includes(name);
}
function extractEntry(html, config) {
  if (typeof config.receptionName !== 'string' || !config.receptionName.trim()) {
    throw new Error('receptionNameに対象受付の見出しを設定してください');
  }
  const blocks = receptionBlocks(html).filter(block => normalize(block.name) === normalize(config.receptionName));
  if (blocks.length !== 1) throw new Error(`対象受付の見出しが${blocks.length}件です。別の受付は選びません`);
  const block = blocks[0];
  const buttons = [...block.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
    .map(anchor => ({ attrs: attributes(anchor[1]), label: text(anchor[2]) }))
    .filter(button => hasClass(button.attrs, 'common-btn'));
  if (buttons.length !== 1) throw new Error(`対象受付内の申込リンクタグが${buttons.length}件です`);
  const button = buttons[0];
  const href = (button.attrs.href || '').trim();
  const unpublished = () => {
    const error = new Error('対象受付のリンクは未公開です（hrefが空、仮リンク、または無効化されています）');
    error.code = 'UNPUBLISHED';
    throw error;
  };
  if (!href || href.startsWith('#') || /^javascript:/i.test(href)) unpublished();
  const url = new URL(href, config.tourUrl);
  const official = url.origin === 'https://mrsgreenapple.com' && url.pathname.startsWith('/feature/');
  const external = url.protocol === 'https:' && ['w.pia.jp', 't.pia.jp', 'pia.jp'].includes(url.hostname) && !url.username && !url.password;
  if (!official && !external) throw new Error('申込リンクが対応する公式受付ページ・チケットぴあではありません。移動しません');
  if (button.attrs['aria-disabled'] === 'true' || /pointer-events\s*:\s*none/i.test(button.attrs.style || '')) unpublished();
  return { name: block.name, url: url.href, buttonLabel: button.label, destination: official ? 'official' : 'pia' };
}

function receptionBlocks(html) {
  const source = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  const headings = [...source.matchAll(/<h3\b([^>]*)>([\s\S]*?)<\/h3\s*>/gi)];
  return headings.map((heading, index) => ({ name: text(heading[2]), attrs: attributes(heading[1]), html: source.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? source.length) }))
    .filter(block => hasClass(block.attrs, 'slide-toggle'));
}
function receptionSection(html, label) {
  const headings = [...html.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4\s*>/gi)];
  const index = headings.findIndex(heading => normalize(text(heading[1])) === label);
  if (index < 0) return '';
  const heading = headings[index];
  return html.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? html.length)
    .split(/<ul\b|<a\b|<h5\b/i)[0];
}
function officialDates(html, year) {
  const source = text(html).normalize('NFKC');
  const dates = [];
  for (const match of source.matchAll(/(?:(\d{4})年\s*)?(\d{1,2})月\s*(\d{1,2})日\s*(?:\(([^)]*)\))?\s*(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?/g)) {
    const actualYear = Number(match[1] || year), month = Number(match[2]), day = Number(match[3]);
    const iso = `${actualYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const stamp = Date.parse(iso + 'T00:00:00Z');
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== iso) continue;
    const hour = match[5] === undefined ? null : Number(match[5]), minute = Number(match[6] || 0), second = Number(match[7] || 0);
    const time = hour !== null && hour <= 23 && minute <= 59 && second <= 59 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}` : null;
    dates.push({ iso, label: `${month}/${day}${match[4] ? `（${match[4]}）` : ''}${time ? ' ' + time.slice(0, 5) : ''}`, time });
  }
  return dates;
}
function listReceptions(html, tourUrl, referenceYear = new Date(Date.now() + 9 * 3600000).getUTCFullYear()) {
  // 年のない日付は公式のツアー説明の年を優先する。各日付に年が書かれていればそちらを使う。
  const description = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0])).find(attrs => attrs.name === 'description');
  const year = Number(description?.content?.match(/(\d{4})年/)?.[1] || referenceYear);
  const entries = [];
  for (const block of receptionBlocks(html)) {
    if (!normalize(block.name).includes('先着')) continue;
    let entry;
    try { entry = { ...extractEntry(html, { tourUrl, receptionName: block.name }), unpublished: false }; }
    catch (error) { if (error.code !== 'UNPUBLISHED') continue; entry = { name: block.name, url: null, buttonLabel: '未公開', unpublished: true }; }
    const seatHtml = receptionSection(block.html, '対象席種');
    const seats = [...new Set(seatHtml.split(/(?:＜|&lt;|〈)注意事項/)[0].replace(/<br\b[^>]*>/gi, '\n').split('\n').map(line => text(line).normalize('NFKC').replace(/^[・●\-\s]+/, '').trim())
      .filter(line => line && !/^【/.test(line) && /(?:席|エリア|立見|立ち見)(?:\s*[（(].*?[）)])?$/.test(line)))];
    const dates = officialDates(receptionSection(block.html, '対象公演'), year).filter((date, index, all) => all.findIndex(item => item.iso === date.iso) === index);
    const periodHtml = receptionSection(block.html, '受付期間');
    const start = officialDates(periodHtml, year).find(date => date.time);
    // 公演別の受付期間は開始を一意に決められないので自動設定しない。
    const startAt = start && !/[[【][^\]】]*公演/.test(text(periodHtml)) ? `${start.iso}T${start.time}.000+09:00` : null;
    entries.push({ ...entry, seats, dates, startAt });
  }
  return entries;
}

async function discover(config, fetchHtml, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const attempts = config.discoveryAttempts ?? 1;
  const interval = config.discoveryIntervalMs ?? 1000;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 30) throw new Error('discoveryAttemptsは1〜30にしてください');
  if (!Number.isInteger(interval) || interval < 100) throw new Error('discoveryIntervalMsは100以上にしてください');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const html = await fetchHtml(config.tourUrl);
    try {
      return extractEntry(html, config);
    } catch (error) {
      if (error.code !== 'UNPUBLISHED' || attempt === attempts) throw error;
      console.log(`リンク未公開。${interval} ms後に公式ツアーページを再確認します (${attempt}/${attempts})`);
      await pause(interval);
    }
  }
}

function extractLinks(html) {
  const links = [];
  // 公式ページのaタグからhrefを読み、HTMLの文字参照を復元します。
  const decode = (text) => text.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    const lower = entity.toLowerCase();
    if (named[lower]) return named[lower];
    const hex = lower.startsWith('&#x');
    const value = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return value <= 0x10ffff ? String.fromCodePoint(value) : entity;
  });
  const source = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  for (const tag of source.matchAll(/<a\b[^>]*>/gi)) {
    const match = tag[0].match(/\s+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!match) continue;
    let url;
    try { url = new URL(decode(match[1] ?? match[2] ?? match[3])); } catch { continue; }
    if (url.origin === 'https://tixplus.jp' && url.pathname === '/ticket/order/login.php' && !links.includes(url.href)) {
      links.push(url.href);
    }
  }
  return links;
}

function extractReception(html) {
  const source = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  const text = value => (value || '').replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  function byClass(className) {
    for (const match of source.matchAll(/<(h1|p)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
      const classes = match[2].match(/\bclass\s*=\s*["']([^"']*)["']/i);
      if (classes?.[1].split(/\s+/).includes(className)) return text(match[3]);
    }
    return '';
  }
  const title = byClass('mainVisual__headingTitle') || text(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const reception = byClass('mainVisual__headingText') || '取得できませんでした';
  const details = new Map();
  for (const block of source.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl\s*>/gi)) {
    const dateHtml = block[1].match(/<dt\b[^>]*>([\s\S]*?)<\/dt\s*>/i)?.[1];
    const date = text(dateHtml).replace(/(\d{1,2})\.(\d{1,2})\s*([日月火水木金土])/, '$1/$2（$3）');
    for (const anchor of block[1].matchAll(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi)) {
      const url = extractLinks(anchor[0])[0];
      if (url && !details.has(url)) details.set(url, {
        date: date || '取得できませんでした',
        seat: text(anchor[0]).replace(/を\s*購入する\s*$/, '').trim() || '取得できませんでした',
      });
    }
  }
  return { title: title || '取得できませんでした', reception, links: extractLinks(source).map(url => ({
    url, ...(details.get(url) || { date: '取得できませんでした', seat: '取得できませんでした' }),
  })) };
}

function selectTicket(links, config) {
  if (typeof config.performanceDate !== 'string' || !/^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/.test(config.performanceDate)) {
    throw new Error('performanceDateをMM/DD形式で設定してください（例: 10/06）');
  }
  if (typeof config.seatName !== 'string' || !config.seatName.trim()) {
    throw new Error('seatNameにページに表示されている席名を設定してください');
  }
  const matches = links.filter(entry => {
    const date = entry.date.match(/^(\d{1,2})\/(\d{1,2})(?:（[日月火水木金土]）)?$/);
    const normalized = date ? `${date[1].padStart(2, '0')}/${date[2].padStart(2, '0')}` : null;
    return normalized === config.performanceDate && entry.seat === config.seatName;
  });
  if (matches.length !== 1) {
    throw new Error(`${config.performanceDate} / ${config.seatName} に一致する購入URLが${matches.length}件です。移動しません`);
  }
  return matches[0];
}
