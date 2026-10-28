const $ = id => document.getElementById(id);
const storageKey = 'ticket-pages-config-v1';
let job = null;
let countdownTarget = null;
let receptionEntries = [];
let preferredDateIso = '';
let preferredSeat = '';
// 混雑時は同じ取得でも応答時間が大きくばらつくため、時間差で複数回取得して最初に使える結果を採用する。
let hedgeDelays = [0, 200, 400, 700, 1000];
let hedgeLead = 200; // 予約時は取得日時のこの時間前に1本目を出す
const warmOrigins = [['https://mrsgreenapple.com', 'anonymous'], ['https://tixplus.jp', '']];
function jst(ms) { return new Date(ms + 9 * 3600000).toISOString().replace('Z', '+09:00'); }
function log(message) {
  const box = $('log');
  if (box.dataset.started !== 'yes') { box.textContent = ''; box.dataset.started = 'yes'; }
  box.textContent += `${jst(Date.now()).slice(11, 23)}  ${message}\n`;
  box.scrollTop = box.scrollHeight;
}
function state(title, detail, badge) { $('run-heading').textContent = title; $('detail').textContent = detail; $('badge').textContent = badge; $('mini-badge').textContent = badge; }
function saveSettings(cfg) {
  try { localStorage.setItem(storageKey, JSON.stringify(cfg)); }
  catch { $('save-note').textContent = 'このブラウザでは保存できません。設定は今回の実行だけに使います。'; }
}
function composeTime(date, time, milliseconds) {
  if (!date || !time) return '';
  const ms = Number(milliseconds);
  if (milliseconds === '' || !Number.isInteger(ms) || ms < 0 || ms > 999) throw new Error('ミリ秒は0〜999の整数を入力してください。');
  const seconds = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  return `${date}T${seconds}.${String(ms).padStart(3, '0')}+09:00`;
}
function restoreTime(prefix, value) {
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?\+09:00$/);
  if (!match) return;
  $(prefix + 'Date').value = match[1];
  const [hour, minute, second] = match[2].split(':');
  $(prefix + 'Hour').value = Number(hour); $(prefix + 'Minute').value = Number(minute); $(prefix + 'Second').value = Number(second); $(prefix + 'Ms').value = Number(match[3] || 0);
}
function composeParts(date, hour, minute, second, ms) {
  if (!date) return '';
  for (const [value, max, label] of [[hour, 23, '時'], [minute, 59, '分'], [second, 59, '秒']]) {
    if (value === '' || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > max) throw new Error(`${label}は0〜${max}の整数を入力してください。`);
  }
  return composeTime(date, [hour, minute, second].map(value => String(Number(value)).padStart(2, '0')).join(':'), String(ms));
}
function fetchTimeFromInputs() {
  return composeParts($('fetchDate').value, $('fetchHour').value, $('fetchMinute').value, $('fetchSecond').value, $('fetchMs').value);
}
function delayMilliseconds(value) {
  const seconds = Number(value), ms = Math.round(seconds * 1000);
  if (value === '' || !Number.isFinite(seconds) || seconds < 0 || seconds > 86400 || Math.abs(seconds * 1000 - ms) > 0.000001) throw new Error('移動までの秒数は0〜86400、小数は3桁までで入力してください。');
  return ms;
}
function calculateOpenAt(fetchAt, seconds) {
  const offset = delayMilliseconds(seconds);
  if (!fetchAt) return '';
  const target = Date.parse(fetchAt);
  if (!Number.isFinite(target)) throw new Error('取得日時を確認してください。');
  return jst(target + offset);
}
function updateTimeSummaries() {
  $('fetchTimePicker').value = ['Hour', 'Minute', 'Second'].map(part => String($('fetch' + part).value).padStart(2, '0')).join(':');
  syncTimeWheels();
  try {
    const value = fetchTimeFromInputs();
    const open = calculateOpenAt(value, $('openDelaySeconds').value);
    $('fetch-summary').textContent = value ? value.replace('T', ' ').replace('+09:00', ' JST') : '日付と時刻を選択してください。';
    $('open-time-view').textContent = open ? open.slice(11, 23) : '--:--:--.---';
    $('open-summary').textContent = open ? open.slice(0, 10) + ' JST' : '取得日時を設定すると自動計算します。';
  } catch (error) { $('fetch-summary').textContent = error.message; $('open-time-view').textContent = '--:--:--.---'; $('open-summary').textContent = ''; }
  for (const button of document.querySelectorAll('[data-delay]')) button.setAttribute('aria-pressed', String(button.dataset.delay === $('openDelaySeconds').value));
}
function performanceMonthDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('公演日をカレンダーから選択してください。');
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new Error('公演日が実在しません。カレンダーから選択してください。');
  return value.slice(5).replace('-', '/');
}
function restorePerformanceDate(saved) {
  const iso = saved.performanceDateIso || (/^\d{2}\/\d{2}$/.test(saved.performanceDate || '') ? `${jst(Date.now()).slice(0, 4)}-${saved.performanceDate.replace('/', '-')}` : '');
  try { performanceMonthDay(iso); $('performanceDate').value = iso; preferredDateIso = iso; }
  catch { $('performanceDate').value = ''; }
}
function readSettings() {
  const cfg = Object.fromEntries(new FormData($('settings-form')));
  cfg.performanceDate = performanceMonthDay(cfg.performanceDateIso);
  cfg.fetchAt = composeParts(cfg.fetchDate, cfg.fetchHour, cfg.fetchMinute, cfg.fetchSecond, cfg.fetchMs);
  cfg.openAt = calculateOpenAt(cfg.fetchAt, cfg.openDelaySeconds);
  cfg.openDelaySeconds = Number(cfg.openDelaySeconds);
  cfg.discoveryAttempts = Number(cfg.discoveryAttempts);
  cfg.discoveryIntervalMs = Number(cfg.discoveryIntervalMs);
  const url = new URL(cfg.tourUrl);
  if (url.origin !== 'https://mrsgreenapple.com') throw new Error('公式サイトのHTTPS URLを入力してください。');
  if (!cfg.receptionName.trim()) throw new Error('公式ページの受付一覧から受付を選択してください。');
  const entry = receptionEntries.find(item => normalize(item.name) === normalize(cfg.receptionName));
  if (!entry) throw new Error('公式ページの受付一覧を取得し、先着受付を選択してください。');
  if (!entry.dates.some(date => date.iso === cfg.performanceDateIso)) throw new Error('対象受付の公演日を選択してください。');
  if (!entry.seats.includes(cfg.seatName)) throw new Error('対象受付の席種を選択してください。');
  if (!Number.isInteger(cfg.discoveryAttempts) || cfg.discoveryAttempts < 1 || cfg.discoveryAttempts > 30) throw new Error('最大取得回数は1〜30です。');
  if (!Number.isInteger(cfg.discoveryIntervalMs) || cfg.discoveryIntervalMs < 100) throw new Error('再取得の待ち時間は100ms以上です。');
  return cfg;
}
function scheduleTime(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?\+09:00$/.test(value)) throw new Error(`${name}を例の書式・日本時間で入力してください。`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= Date.now()) throw new Error(`${name}が無効、または過去です。`);
  if (jst(ms) !== value.replace(/(T\d{2}:\d{2}:\d{2})(?=\+)/, '$1.000')) throw new Error(`${name}の日付または時刻が実在しません。`);
  return ms;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('解除しました', 'AbortError')); };
    if (signal.aborted) { reject(new DOMException('解除しました', 'AbortError')); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function waitUntil(target, signal) {
  while (Date.now() < target) {
    const remaining = target - Date.now();
    await sleep(Math.min(remaining, remaining > 1000 ? 1000 : remaining > 50 ? 10 : 1), signal);
  }
  signal.throwIfAborted();
}
// 待機中に接続(TLS)を開いておく。使われない接続は10秒ほどで閉じられるので直前に呼ぶ。
// 公式サイトはcredentials: 'omit'のfetch用にanonymous、tixplusは通常の画面遷移用。
function warmConnections(origins = warmOrigins) {
  for (const [href, crossOrigin] of origins) {
    const link = document.createElement('link'); link.rel = 'preconnect'; link.href = href;
    if (crossOrigin) link.crossOrigin = crossOrigin;
    document.head.append(link);
  }
}
async function fetchHtml(url, signal, label = '') {
  const started = performance.now();
  log(`HTML取得開始${label}: ${url}`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTML取得に失敗: HTTP ${response.status}`);
    if (new URL(response.url).origin !== 'https://mrsgreenapple.com') throw new Error('公式サイト外へ転送されました。');
    const html = await response.text();
    signal.throwIfAborted();
    log(`HTML取得完了${label}: ${(performance.now() - started).toFixed(1)} ms`);
    return html;
  } catch (error) {
    signal.throwIfAborted();
    if (error.name === 'AbortError') throw new Error('HTML取得が20秒でタイムアウトしました。');
    if (error.name === 'TypeError') throw new Error('HTMLを取得できません。通信状態・CORS許可を確認してください。');
    throw error;
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}
// delaysの時間差で取得し、acceptが成功した最初の結果を返して残りは取り消す。
// 全て失敗したら未公開(UNPUBLISHED)を優先して返し、呼び出し側の再取得判定に使う。
function fetchFirst(url, signal, accept, delays = hedgeDelays) {
  const group = new AbortController();
  const stop = () => group.abort(signal.reason);
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  return new Promise((resolve, reject) => {
    const errors = [];
    delays.forEach((delay, i) => {
      const label = delays.length > 1 ? `(${i + 1}/${delays.length})` : '';
      sleep(delay, group.signal).then(() => fetchHtml(url, group.signal, label)).then(html => {
        if (group.signal.aborted) return;
        const result = accept(html);
        group.abort(); resolve({ html, result });
      }).catch(error => {
        errors.push(error);
        if (errors.length === delays.length) reject(signal.aborted ? errors[0] : errors.find(item => item.code === 'UNPUBLISHED') || errors[0]);
      });
    });
  }).finally(() => { group.abort(); signal.removeEventListener('abort', stop); });
}
function showCandidates(info, cfg) {
  const list = $('candidates');
  list.replaceChildren();
  $('candidates-section').className = '';
  $('link-count').textContent = `${info.links.length}件`;
  $('selected-seat').textContent = `自動で開く席: ${cfg.performanceDate} / ${cfg.seatName}`;
  info.links.forEach((item, i) => {
    const li = document.createElement('li');
    const match = item.date.match(/^(\d{1,2})\/(\d{1,2})/);
    if (match && `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}` === cfg.performanceDate && item.seat === cfg.seatName) li.className = 'selected';
    li.textContent = `${i + 1}. ${item.date} / ${item.seat}${item.seat.includes('着席') ? '   (着席)' : ''}`;
    const a = document.createElement('a');
    a.href = item.url; a.className = 'url'; a.rel = 'noopener noreferrer'; a.target = '_blank'; a.textContent = item.url;
    li.append(a); list.append(li);
  });
  if (!info.links.length) { $('selected-seat').textContent = '席の購入リンクはありません（未公開・受付終了などの可能性）。'; log('席の購入リンクは0件です（未公開・受付終了などの可能性）。'); }
}
function populateChoices(id, choices, desired, placeholder) {
  const select = $(id); select.replaceChildren();
  const blank = document.createElement('option'); blank.value = ''; blank.textContent = placeholder; select.append(blank);
  for (const choice of choices) {
    const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label; select.append(option);
  }
  select.value = choices.some(choice => choice.value === desired) ? desired : '';
}
function selectedReception() {
  return receptionEntries.find(entry => normalize(entry.name) === normalize($('receptionName').value));
}
function setOfficialStart(entry) {
  if (!entry?.startAt) return;
  restoreTime('fetch', jst(Date.parse(entry.startAt) + 100));
  timeChanged();
}
function applyReception(entry, applyStart = false) {
  const desiredDate = $('performanceDate').value || preferredDateIso, desiredSeat = $('seatName').value || preferredSeat;
  populateChoices('performanceDate', (entry?.dates || []).map(date => ({ value: date.iso, label: date.label })), desiredDate, '公演日を選択');
  populateChoices('seatName', (entry?.seats || []).map(seat => ({ value: seat, label: seat + (seat.includes('着席') ? ' (着席)' : '') })), desiredSeat, '席種を選択');
  $('selection-note').textContent = entry ? (!entry.dates.length || !entry.seats.length ? '対象公演・対象席種を読み取れませんでした。公式ページを確認してください。' : (entry.destination === 'pia' ? 'チケットぴあ受付です。このツールは申込サイトへの移動まで行い、公演日・席種は遷移先で選択します。' : '選択した受付の対象公演・対象席種だけを表示しています。')) : 'まず公式ページの受付一覧を取得してください。';
  $('official-start').textContent = entry?.startAt ? `販売開始: ${entry.startAt.replace('T', ' ').replace('.000+09:00', ' JST')} / 取得時刻に＋0.1秒を設定` : '販売開始日時が読み取れない場合は手動で設定してください。';
  $('use-official-start').disabled = !entry?.startAt;
  if (applyStart) setOfficialStart(entry);
}
function renderReceptions(html, tourUrl, chosenName, applyStart = false) {
  receptionEntries = listReceptions(html, tourUrl);
  const select = $('receptionChoice'); select.replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '受付を選んでください'; select.append(placeholder);
  for (const entry of receptionEntries) {
    const option = document.createElement('option'); option.value = entry.name;
    option.textContent = `${entry.name} — ${entry.buttonLabel}${entry.destination === 'pia' ? '（チケットぴあ）' : ''}`;
    select.append(option);
    if (normalize(entry.name) === normalize(chosenName)) option.selected = true;
  }
  $('reception-picker').className = '';
  const chosen = receptionEntries.find(entry => normalize(entry.name) === normalize(chosenName));
  select.value = chosen?.name || '';
  $('receptionName').value = chosen?.name || '';
  $('reception-note').textContent = chosen ? `選択中のボタン表示: ${chosen.buttonLabel}` : (receptionEntries.length ? '先着受付を選んでください。' : '先着受付を取得できませんでした。公式ページのURL・構造を確認してください。');
  applyReception(chosen, applyStart);
}
async function loadReceptions() {
  if (job) return;
  job = new AbortController(); $('load-receptions').disabled = true; $('schedule').disabled = true; $('check').disabled = true; $('open-now').disabled = true; $('cancel').disabled = false;
  try {
    const tourUrl = $('tourUrl').value;
    if (new URL(tourUrl).origin !== 'https://mrsgreenapple.com') throw new Error('公式サイトのHTTPS URLを入力してください。');
    renderReceptions(await fetchHtml(tourUrl, job.signal), tourUrl, $('receptionName').value, true);
  } catch (error) { $('reception-note').textContent = error.message; }
  finally { job = null; $('load-receptions').disabled = false; $('schedule').disabled = false; $('check').disabled = false; $('open-now').disabled = false; $('cancel').disabled = true; }
}
async function resolveReception(cfg, signal, preview = false) {
  let entry, tourHtml;
  for (let attempt = 1; attempt <= cfg.discoveryAttempts; attempt++) {
    signal.throwIfAborted();
    // 時間差取得は初回だけ。未公開時の再取得は1本ずつにしてサーバー負荷を抑える。
    try { ({ html: tourHtml, result: entry } = await fetchFirst(cfg.tourUrl, signal, html => extractEntry(html, cfg), attempt > 1 ? [0] : hedgeDelays)); break; }
    catch (error) {
      if (error.code !== 'UNPUBLISHED' || attempt === cfg.discoveryAttempts) throw error;
      log(`未公開。${cfg.discoveryIntervalMs} ms後に再取得 (${attempt}/${cfg.discoveryAttempts})`);
      await sleep(cfg.discoveryIntervalMs, signal);
    }
  }
  renderReceptions(tourHtml, cfg.tourUrl, cfg.receptionName);
  log(`受付: ${entry.name}`); log(`申込リンク: ${entry.url}`);
  if (entry.destination === 'pia') return { externalEntry: entry, links: [] };
  // ツアーページの取得が長引くと待機中に開いた接続が閉じるため、遷移先への接続を開き直す。
  if (!preview) warmConnections(warmOrigins.slice(1));
  const { result: info } = await fetchFirst(entry.url, signal, extractReception);
  signal.throwIfAborted();
  log(`受付ページ: ${info.reception}`);
  return info;
}
async function execute(cfg, preview, signal, immediate = false) {
  const scheduled = !preview && !immediate;
  let fetchTarget, openTarget;
  if (scheduled) {
    fetchTarget = scheduleTime(cfg.fetchAt, '取得日時');
    openTarget = scheduleTime(cfg.openAt, '移動日時');
    if (openTarget < fetchTarget) throw new Error('移動日時は取得日時以降にしてください。');
  }
  saveSettings(cfg);
  if (scheduled) {
    countdownTarget = fetchTarget;
    state('HTML取得まで待機中', `取得: ${cfg.fetchAt}`, 'WAITING');
    const firstFetch = fetchTarget - hedgeLead;
    await waitUntil(firstFetch - 3000, signal);
    warmConnections();
    await waitUntil(firstFetch, signal);
    log(`取得予定との差: +${Date.now() - firstFetch} ms（取得日時の${hedgeLead} ms前から${hedgeDelays.length}本を時間差で取得）`);
  } else if (!preview) warmConnections();
  countdownTarget = null;
  state('受付と席を取得中', 'ツアーページから対象の受付を探しています。', 'FETCHING');
  const info = await resolveReception(cfg, signal, preview);
  if (info.externalEntry) {
    const entry = info.externalEntry;
    $('candidates').replaceChildren(); $('candidates-section').className = '';
    $('link-count').textContent = '申込サイト';
    $('selected-seat').textContent = 'チケットぴあで公演日・席種を選択してください。';
    const li = document.createElement('li'), link = document.createElement('a');
    li.textContent = entry.name; link.href = entry.url; link.textContent = entry.url; link.className = 'url'; link.target = '_blank'; link.rel = 'noopener noreferrer'; li.append(link); $('candidates').append(li);
    if (preview) { state('受付リンクの確認が完了', 'チケットぴあの申込リンクを取得しました。移動は行いません。', 'CHECKED'); return; }
    $('manual-link').href = entry.url; $('manual-link').className = '';
    if (scheduled && Date.now() < openTarget) { countdownTarget = openTarget; state('申込サイトへの移動待ち', entry.name, 'READY TO OPEN'); await waitUntil(openTarget, signal); }
    signal.throwIfAborted(); state('申込サイトへ移動します', '公演日・席種はチケットぴあで選択してください。', 'OPENING'); location.assign(entry.url); return;
  }
  showCandidates(info, cfg);
  if (preview) { state('一覧の確認が完了', `${info.links.length}件の購入リンクを取得しました。移動は行いません。`, 'CHECKED'); return; }
  if (!info.links.length) throw new Error(`この受付には購入リンクが0件です。${info.reception}。「公式ページの受付一覧を取得」で対象の受付を選び直してください。`);
  let selected;
  try { selected = selectTicket(info.links, cfg); }
  catch (error) {
    const available = info.links.map(item => `${item.date} / ${item.seat}`).join('、');
    throw new Error(`${error.message} この受付で取得した候補: ${available}`);
  }
  log(`選択: ${selected.date} / ${selected.seat}`);
  $('manual-link').href = selected.url; $('manual-link').className = '';
  if (scheduled && Date.now() < openTarget) {
    countdownTarget = openTarget;
    state('購入URLへの移動待ち', `${selected.date} / ${selected.seat}`, 'READY TO OPEN');
    await waitUntil(openTarget, signal);
  }
  signal.throwIfAborted();
  if (scheduled) log(`移動予定との差: +${Date.now() - openTarget} ms`);
  else log('HTML取得と席の選択が完了しました。今すぐ移動します。');
  state('購入URLへ移動します', `${selected.date} / ${selected.seat}`, 'OPENING');
  location.assign(selected.url);
}
async function start(preview, immediate = false) {
  if (job || !$('settings-form').reportValidity()) return;
  let cfg;
  try { cfg = readSettings(); } catch (error) { state('設定を確認してください', error.message, 'ERROR'); return; }
  job = new AbortController();
  $('fields').disabled = true; $('schedule').disabled = true; $('check').disabled = true; $('open-now').disabled = true; $('cancel').disabled = false;
  $('manual-link').className = 'hidden'; $('log').dataset.started = ''; $('candidates').replaceChildren(); $('candidates-section').className = 'hidden';
  try { await execute(cfg, preview, job.signal, immediate); }
  catch (error) { log(error.message); state(error.name === 'AbortError' ? '予約を解除しました' : '処理を停止しました', error.message, error.name === 'AbortError' ? 'CANCELLED' : 'ERROR'); }
  finally { job = null; countdownTarget = null; $('fields').disabled = false; $('schedule').disabled = false; $('check').disabled = false; $('open-now').disabled = false; $('cancel').disabled = true; }
}
$('settings-form').addEventListener('submit', event => { event.preventDefault(); start(false); });
$('check').addEventListener('click', () => start(true));
$('open-now').addEventListener('click', () => start(false, true));
$('cancel').addEventListener('click', () => { job?.abort(); $('manual-link').className = 'hidden'; });
$('settings-form').addEventListener('change', () => { try { saveSettings(readSettings()); } catch {} });
$('settings-form').addEventListener('input', updateTimeSummaries);
$('load-receptions').addEventListener('click', loadReceptions);
$('receptionChoice').addEventListener('change', () => {
  const selected = receptionEntries.find(entry => entry.name === $('receptionChoice').value);
  if (!selected) { $('receptionName').value = ''; applyReception(null); return; }
  $('receptionName').value = selected.name;
  $('reception-note').textContent = `選択中のボタン表示: ${selected.buttonLabel}`;
  applyReception(selected, true);
  try { saveSettings(readSettings()); } catch {}
});
$('performanceDate').addEventListener('change', () => { preferredDateIso = $('performanceDate').value; });
$('seatName').addEventListener('change', () => { preferredSeat = $('seatName').value; });
$('tourUrl').addEventListener('input', () => {
  receptionEntries = []; $('receptionName').value = '';
  populateChoices('receptionChoice', [], '', '一覧を取得して受付を選択');
  applyReception(null);
});
$('use-official-start').addEventListener('click', () => setOfficialStart(selectedReception()));
$('fetchTimePicker').addEventListener('input', () => {
  const match = $('fetchTimePicker').value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return;
  $('fetchHour').value = Number(match[1]); $('fetchMinute').value = Number(match[2]); $('fetchSecond').value = Number(match[3] || 0); timeChanged();
});
function syncTimeWheels(force = false) {
  for (const part of ['Hour', 'Minute', 'Second']) {
    const wheel = $('wheel' + part), value = Number($('fetch' + part).value);
    if (!force && wheel.dataset.value === String(value)) continue;
    wheel.dataset.value = String(value); wheel.scrollTop = value * 40;
    for (const button of wheel.children) button.setAttribute?.('aria-pressed', String(Number(button.dataset.value) === value));
  }
}
function chooseWheel(part, value) {
  if (job) return;
  $('fetch' + part).value = value;
  timeChanged();
}
for (const [part, maximum] of [['Hour', 23], ['Minute', 59], ['Second', 59]]) {
  const wheel = $('wheel' + part);
  for (let value = 0; value <= maximum; value++) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.value = String(value); button.textContent = String(value).padStart(2, '0');
    button.addEventListener('click', () => chooseWheel(part, value)); wheel.append(button);
  }
  let timer;
  wheel.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const value = Math.max(0, Math.min(maximum, Math.round(wheel.scrollTop / 40)));
      if (value !== Number($('fetch' + part).value)) chooseWheel(part, value);
    }, 120);
  });
}
$('fetchDate').value = jst(Date.now()).slice(0, 10);
function timeChanged() { updateTimeSummaries(); try { saveSettings(readSettings()); } catch {} }
$('fetch-today').addEventListener('click', () => { $('fetchDate').value = jst(Date.now()).slice(0, 10); timeChanged(); });
$('fetch-at-14').addEventListener('click', () => {
  $('fetchHour').value = 14; $('fetchMinute').value = 0; $('fetchSecond').value = 0; $('fetchMs').value = 0; timeChanged();
});
$('fetch-one-minute').addEventListener('click', () => { restoreTime('fetch', jst(Math.ceil((Date.now() + 60000) / 1000) * 1000)); timeChanged(); });
function shiftFetchTime(delta) {
  const value = fetchTimeFromInputs();
  const target = Date.parse(value);
  if (!Number.isFinite(target)) throw new Error('取得日時を先に設定してください。');
  restoreTime('fetch', jst(target + delta)); timeChanged();
}
for (const button of document.querySelectorAll('[data-part], [data-shift]')) {
  button.addEventListener('click', () => {
    try {
      const unit = { Hour: 3600000, Minute: 60000, Second: 1000, Ms: 1 };
      const delta = button.dataset.part ? Number(button.dataset.delta) * unit[button.dataset.part] : Number(button.dataset.shift);
      shiftFetchTime(delta);
    } catch (error) { $('fetch-summary').textContent = error.message; }
  });
}
for (const button of document.querySelectorAll('[data-delay]')) {
  button.addEventListener('click', () => { $('openDelaySeconds').value = button.dataset.delay; timeChanged(); });
}
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (saved) {
    for (const [key, value] of Object.entries(saved)) if ($(key) && ['INPUT', 'TEXTAREA', 'SELECT'].includes($(key).tagName)) $(key).value = value;
    restoreTime('fetch', saved.fetchAt);
    restorePerformanceDate(saved);
    preferredDateIso = saved.performanceDateIso || preferredDateIso; preferredSeat = saved.seatName || preferredSeat;
    $('openDelaySeconds').value = saved.openDelaySeconds === undefined ? 3 : saved.openDelaySeconds;
  }
} catch {}
applyReception(null);
updateTimeSummaries();
document.addEventListener('visibilitychange', () => { if (job && document.hidden) log('ページが非表示になりました。タイマーが遅れる場合があります。'); });
window.addEventListener('resize', () => syncTimeWheels(true));
window.addEventListener('beforeunload', event => { if (job && $('badge').textContent !== 'OPENING') { event.preventDefault(); event.returnValue = ''; } });
setInterval(() => {
  $('clock').textContent = jst(Date.now()).slice(11, 23);
  if (countdownTarget === null) { $('countdown').textContent = $('mini-countdown').textContent = '--:--:--.---'; return; }
  const ms = Math.max(0, countdownTarget - Date.now());
  const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60, seconds = Math.floor(ms / 1000) % 60;
  $('countdown').textContent = $('mini-countdown').textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}, 100);
