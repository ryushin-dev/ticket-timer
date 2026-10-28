import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const core = readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const url = 'https://tixplus.jp/ticket/order/login.php?tour=15079&precede=17';
const cfg = { tourUrl: 'https://mrsgreenapple.com/feature/ringojamtour_shadows', receptionName: '千葉(10)月公演 OFFICIAL FAN CLUB「Ringo Jam」直前追加販売(先着)', performanceDate: '10/15', seatName: '注釈付き指定席', discoveryAttempts: 2, discoveryIntervalMs: 100 };
const block = href => `<h3 class="slide-toggle">千葉（１０）月公演<br>OFFICIAL FAN CLUB「Ringo Jam」<br>直前追加販売（先着）</h3><a class="common-btn green-btn" href="${href}">受付終了</a>`;
const reception = `<h1>公演</h1><dl><dt>10.15<span>木</span></dt><dd><a href="${url.replace('&', '&amp;')}">注釈付き指定席を<br>購入する</a></dd></dl>`;
function harness(options = {}) {
  let now = Date.now(), calls = 0;
  const base = now, events = [], elements = new Map();
  class Clock extends Date { static now() { return now; } }
  function element() { return { dataset: {}, textContent: '', value: '', className: '', tagName: 'INPUT', children: [], listeners: {}, addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }, setAttribute(name, value) { this[name] = value; }, replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); }, reportValidity() { return true; } }; }
  // realTimersでは並行する時間差取得を実時間で再現する。
  const timers = options.realTimers ? { Date, setTimeout, clearTimeout } : {
    Date: Clock, clearTimeout() {},
    setTimeout(callback, ms) { if (ms === 20000) return {}; options.onWait?.({ elements, events, ms }); queueMicrotask(() => { now += ms; callback(); }); return {}; },
  };
  const elapsed = () => (options.realTimers ? Date.now() : now) - base;
  const context = {
    URL, performance, console, AbortController, DOMException, ...timers,
    document: { head: element(), getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element, querySelectorAll() { return []; }, addEventListener() {} },
    window: { addEventListener() {} }, location: { assign(href) { events.push(['open', href, elapsed()]); } },
    localStorage: { getItem() { return null; }, setItem() {} },
    setInterval() {},
    fetch: options.fetch && ((href, request) => { events.push(['fetch', href, elapsed()]); return options.fetch(href, request); }),
  };
  context.fetch ||= async function (href, request) {
    events.push(['fetch', href, now - base]); calls++;
    assert.equal(request.credentials, 'omit'); assert.equal(request.headers, undefined);
    if (options.networkError) throw new TypeError('Failed to fetch');
    return { ok: true, url: href, async text() {
      if (calls === 1 && options.firstUnpublished) return block('');
      if (href === cfg.tourUrl) return options.tourHtml || block('/feature/entry');
      if (options.bodyGate) await options.bodyGate;
      now += options.bodyDelay || 0;
      events.push(['body-complete', now - base]);
      return options.noSeats ? '' : options.receptionHtml || reception;
    } };
  };
  vm.createContext(context); vm.runInContext(core + '\n' + app, context);
  // 既存テストは仮の時計で1本ずつ取得する。時間差取得はrealTimersのテストで確認する。
  if (!options.realTimers) vm.runInContext('hedgeDelays = [0]; hedgeLead = 0', context);
  context.testConfig = { ...cfg, fetchAt: new Date(base + 100).toISOString().replace('Z', '+00:00'), openAt: new Date(base + 200).toISOString().replace('Z', '+00:00') };
  // UI入力と同じJST形式にする。
  context.testConfig.fetchAt = new Date(base + 100 + 9 * 3600000).toISOString().replace('Z', '+09:00');
  context.testConfig.openAt = new Date(base + 200 + 9 * 3600000).toISOString().replace('Z', '+09:00');
  context.controller = new AbortController();
  return { context, events, elements, run(preview = false, immediate = false) { return vm.runInContext(`execute(testConfig, ${preview}, controller.signal, ${immediate})`, context); } };
}
test('取得が移動時刻を超えても本文取得・席選択後に移動する', async () => {
  const h = harness({ bodyDelay: 500 }); await h.run();
  assert.deepEqual(h.events.at(-1), ['open', url, 600]);
  assert.equal(h.events[0][2], 100);
  assert.equal(h.events.at(-2)[0], 'body-complete');
});
// 応答の遅延と本文を呼び出し順に指定するfetch。取り消されたら中断する。
function delayedFetch(plan) {
  let calls = 0; const aborted = [];
  const fetch = (href, request) => {
    const [delay, body] = plan(href, ++calls), index = calls;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, url: href, async text() { return body; } }), delay);
      request.signal.addEventListener('abort', () => { clearTimeout(timer); aborted.push(index); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
    });
  };
  return { fetch, aborted };
}
test('時間差取得は遅い1本目を待たず、先に返った2本目を使って残りを取り消す', async () => {
  const { fetch, aborted } = delayedFetch((href, call) => href === cfg.tourUrl ? [call === 1 ? 1000 : 20, block('/feature/entry')] : [10, reception]);
  const h = harness({ realTimers: true, fetch });
  await h.run(false, true);
  const tours = h.events.filter(e => e[0] === 'fetch' && e[1] === cfg.tourUrl);
  assert.equal(tours.length, 2);
  assert.ok(tours[1][2] >= 190, '2本目は200ms後');
  assert.deepEqual(aborted, [1]);
  assert.equal(h.events.filter(e => e[0] === 'fetch' && e[1] !== cfg.tourUrl).length, 1, '受付ページは1本目が速ければ追加取得しない');
  const opened = h.events.at(-1);
  assert.equal(opened[1], url); assert.ok(opened[2] < 600, `${opened[2]} ms`);
});
test('時間差取得で先に返った未公開は捨て、公開済みの結果を使う', async () => {
  const { fetch } = delayedFetch((href, call) => href === cfg.tourUrl ? (call === 1 ? [10, block('')] : [10, block('/feature/entry')]) : [10, reception]);
  const h = harness({ realTimers: true, fetch });
  await h.run(false, true);
  assert.equal(h.events.filter(e => e[0] === 'fetch' && e[1] === cfg.tourUrl).length, 2);
  assert.equal(h.events.at(-1)[1], url);
});
test('時間差取得が全て未公開なら、再取得は1本ずつ行う', async () => {
  const { fetch } = delayedFetch((href, call) => href === cfg.tourUrl ? [5, block(call <= 5 ? '' : '/feature/entry')] : [5, reception]);
  const h = harness({ realTimers: true, fetch });
  await h.run(false, true);
  assert.equal(h.events.filter(e => e[0] === 'fetch' && e[1] === cfg.tourUrl).length, 6);
  assert.equal(h.events.at(-1)[1], url);
});
test('予約は取得日時の少し前から時間差で取得し、事前に接続を開く', async () => {
  const { fetch } = delayedFetch(href => [5, href === cfg.tourUrl ? block('/feature/entry') : reception]);
  const h = harness({ realTimers: true, fetch });
  h.context.testConfig.fetchAt = new Date(Date.now() + 400 + 9 * 3600000).toISOString().replace('Z', '+09:00');
  h.context.testConfig.openAt = h.context.testConfig.fetchAt;
  const started = Date.now();
  await h.run();
  const first = h.events.find(e => e[0] === 'fetch');
  assert.ok(Date.now() - started >= 200 && first[2] < 400 - 150, `1本目 ${first[2]} ms`);
  const links = h.context.document.head.children.map(link => [link.rel, link.href, link.crossOrigin]);
  assert.deepEqual(links.slice(0, 2), [['preconnect', 'https://mrsgreenapple.com', 'anonymous'], ['preconnect', 'https://tixplus.jp', undefined]]);
  assert.deepEqual(links.at(-1), ['preconnect', 'https://tixplus.jp', undefined], '受付ページ取得前に遷移先へ接続し直す');
  assert.equal(h.events.at(-1)[1], url);
});
test('一覧確認も時間差で取得するが、移動しないので接続準備はしない', async () => {
  const { fetch, aborted } = delayedFetch((href, call) => [call === 1 ? 1000 : 20, href === cfg.tourUrl ? block('/feature/entry') : reception]);
  const h = harness({ realTimers: true, fetch });
  await h.run(true);
  assert.equal(h.events.filter(e => e[0] === 'fetch' && e[1] === cfg.tourUrl).length, 2);
  assert.deepEqual(aborted, [1]);
  assert.equal(h.elements.get('candidates').children.length, 1);
  assert.ok(!h.events.some(e => e[0] === 'open'));
  assert.equal(h.context.document.head.children.length, 0);
});
test('取得が早ければ移動時刻まで待つ', async () => {
  const h = harness(); await h.run(); assert.deepEqual(h.events.at(-1), ['open', url, 200]);
});
test('一覧確認では移動せず、リンクを表示する', async () => {
  const h = harness(); await h.run(true);
  assert.ok(!h.events.some(e => e[0] === 'open'));
  assert.equal(h.elements.get('candidates').children.length, 1);
});
test('即時取得・移動は設定日時を使わず、本文取得後に希望席へ移動する', async () => {
  const h = harness({ bodyDelay: 500 });
  h.context.testConfig.fetchAt = ''; h.context.testConfig.openAt = '過去または不正な日時';
  await h.run(false, true);
  assert.equal(h.events[0][2], 0);
  assert.deepEqual(h.events.at(-1), ['open', url, 500]);
  assert.equal(h.events.at(-2)[0], 'body-complete');
});
test('即時移動でも希望席がなければ停止する', async () => {
  const h = harness({ noSeats: true }); await assert.rejects(h.run(false, true), /0件/);
  assert.ok(!h.events.some(e => e[0] === 'open'));
});
test('全席URLを先に表示してから移動時刻まで待つ', async () => {
  let observed = false;
  const other = 'https://tixplus.jp/ticket/order/login.php?precede=18';
  const html = reception.replace('</dd>', `<a href="${other}">注釈付き着席指定席を購入する</a></dd>`);
  const h = harness({ receptionHtml: html, onWait({ elements, events }) {
    const panel = elements.get('candidates-section');
    if (panel?.className === '' && elements.get('candidates').children.length === 2) {
      observed = true;
      assert.ok(!events.some(e => e[0] === 'open'));
      assert.equal(elements.get('candidates').children[1].children[0].href, other);
    }
  } });
  await h.run(); assert.ok(observed);
  assert.deepEqual(h.events.at(-1), ['open', url, 200]);
});
test('日時選択をJST・ミリ秒付きに組み立て、従来の保存日時も復元する', () => {
  const h = harness();
  assert.equal(vm.runInContext("composeTime('2026-10-15', '14:00', '21')", h.context), '2026-10-15T14:00:00.021+09:00');
  assert.equal(vm.runInContext("composeTime('2026-10-15', '14:00:03', '500')", h.context), '2026-10-15T14:00:03.500+09:00');
  assert.throws(() => vm.runInContext("composeTime('2026-10-15', '14:00', '1000')", h.context), /0〜999/);
  vm.runInContext("restoreTime('fetch', '2026-10-15T14:00:03.021+09:00')", h.context);
  assert.equal(h.elements.get('fetchDate').value, '2026-10-15');
  assert.equal(Number(h.elements.get('fetchHour').value), 14);
  assert.equal(Number(h.elements.get('fetchMinute').value), 0);
  assert.equal(Number(h.elements.get('fetchSecond').value), 3);
  assert.equal(Number(h.elements.get('fetchMs').value), 21);
});
test('移動日時は取得日時と可変秒数から計算し、日付繰上がりも扱う', () => {
  const h = harness();
  assert.equal(vm.runInContext("calculateOpenAt('2026-10-15T14:00:00.500+09:00', '3')", h.context), '2026-10-15T14:00:03.500+09:00');
  assert.equal(vm.runInContext("calculateOpenAt('2026-10-15T23:59:59.900+09:00', '3.500')", h.context), '2026-10-16T00:00:03.400+09:00');
  assert.equal(vm.runInContext("calculateOpenAt('2026-12-31T23:59:59.999+09:00', '0.001')", h.context), '2027-01-01T00:00:00.000+09:00');
  for (const value of ['', '-1', '3.0001', '86401']) assert.throws(() => vm.runInContext(`delayMilliseconds(${JSON.stringify(value)})`, h.context), /秒数/);
});
test('フォームから取得時刻と３秒後の移動日時を読み取る', () => {
  const h = harness();
  h.context.FormData = function () { return Object.entries({ ...cfg, performanceDateIso: '2026-10-15', fetchDate: '2026-10-15', fetchHour: '14', fetchMinute: '0', fetchSecond: '0', fetchMs: '125', openDelaySeconds: '3' }); };
  h.context.officialEntry = { name: cfg.receptionName, dates: [{ iso: '2026-10-15' }], seats: ['注釈付き指定席'] };
  vm.runInContext('receptionEntries = [officialEntry]', h.context);
  const result = vm.runInContext('readSettings()', h.context);
  assert.equal(result.fetchAt, '2026-10-15T14:00:00.125+09:00');
  assert.equal(result.openAt, '2026-10-15T14:00:03.125+09:00');
  assert.equal(result.openDelaySeconds, 3);
  assert.equal(result.performanceDate, '10/15');
});
test('公演日カレンダーは実在する日付だけを受け付けて月日に変換する', () => {
  const h = harness();
  assert.equal(vm.runInContext("performanceMonthDay('2026-10-15')", h.context), '10/15');
  assert.equal(vm.runInContext("performanceMonthDay('2028-02-29')", h.context), '02/29');
  for (const value of ['', '10/15', 'あああ', '2026-02-29', '2026-02-31', '2026-13-01']) {
    assert.throws(() => vm.runInContext(`performanceMonthDay(${JSON.stringify(value)})`, h.context), /公演日/);
  }
  vm.runInContext("restorePerformanceDate({performanceDateIso:'2027-01-05',performanceDate:'01/05'})", h.context);
  assert.equal(h.elements.get('performanceDate').value, '2027-01-05');
  vm.runInContext("restorePerformanceDate({performanceDate:'10/15'})", h.context);
  assert.match(h.elements.get('performanceDate').value, /^\d{4}-10-15$/);
});
test('時刻の微調整でミリ秒から秒、日付へ繰り上がり、自動移動時刻も更新する', () => {
  const h = harness();
  vm.runInContext("$('openDelaySeconds').value = '3'; restoreTime('fetch', '2026-10-15T23:59:59.950+09:00'); shiftFetchTime(100)", h.context);
  assert.equal(h.elements.get('fetchDate').value, '2026-10-16');
  assert.equal(Number(h.elements.get('fetchHour').value), 0);
  assert.equal(Number(h.elements.get('fetchSecond').value), 0);
  assert.equal(Number(h.elements.get('fetchMs').value), 50);
  assert.equal(h.elements.get('open-time-view').textContent, '00:00:03.050');
});
test('未公開から公開への再取得だけを行う', async () => {
  const h = harness({ firstUnpublished: true }); await h.run(true);
  assert.equal(h.events.filter(e => e[0] === 'fetch' && e[1] === cfg.tourUrl).length, 2);
});
test('キャンセルした取得からは移動しない', async () => {
  let release; const bodyGate = new Promise(resolve => { release = resolve; });
  const h = harness({ bodyGate }); const pending = h.run(true);
  await new Promise(resolve => setImmediate(resolve));
  h.context.controller.abort(); release();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.ok(!h.events.some(e => e[0] === 'open'));
});
test('席なし・通信失敗・時刻逆転で移動しない', async () => {
  const missing = harness({ noSeats: true }); await assert.rejects(missing.run(), /0件/);
  const network = harness({ networkError: true }); await assert.rejects(network.run(), /CORS/);
  const reversed = harness(); reversed.context.testConfig.openAt = reversed.context.testConfig.fetchAt.replace(/\.\d{3}/, '.000');
  reversed.context.testConfig.openAt = new Date(Date.parse(reversed.context.testConfig.fetchAt) - 1 + 9 * 3600000).toISOString().replace('Z', '+09:00');
  await assert.rejects(reversed.run(), /以降/);
  for (const h of [missing, network, reversed]) assert.ok(!h.events.some(e => e[0] === 'open'));
});

test('受付ごとの公演日と席種に絞り、対象外の保存設定は選択しない', () => {
  const h = harness();
  h.context.officialEntry = { name: cfg.receptionName, dates: [{ iso: '2026-10-14', label: '10/14（水）' }, { iso: '2026-10-15', label: '10/15（木）' }], seats: ['注釈付き指定席', '注釈付き着席指定席'], startAt: '2026-10-12T14:00:00.000+09:00' };
  vm.runInContext("$('openDelaySeconds').value = '3'; $('performanceDate').value = '2026-10-15'; $('seatName').value = '指定席'; applyReception(officialEntry, true)", h.context);
  assert.equal(h.elements.get('seatName').value, '');
  assert.deepEqual(h.elements.get('seatName').children.map(option => option.value), ['', '注釈付き指定席', '注釈付き着席指定席']);
  assert.equal(h.elements.get('performanceDate').value, '2026-10-15');
  assert.deepEqual(h.elements.get('performanceDate').children.map(option => option.value), ['', '2026-10-14', '2026-10-15']);
  assert.equal(Number(h.elements.get('fetchMs').value), 100);
  assert.equal(h.elements.get('fetchDate').value, '2026-10-12');
  assert.equal(h.elements.get('open-time-view').textContent, '14:00:03.100');
});
test('予約時の再取得では手動調整した時刻を上書きせず、開始不明も上書きしない', () => {
  const h = harness();
  h.context.officialEntry = { dates: [], seats: [], startAt: '2026-10-12T14:00:00.000+09:00' };
  vm.runInContext("restoreTime('fetch', '2026-10-15T14:00:01.250+09:00'); applyReception(officialEntry); applyReception({dates: [], seats: []}, true)", h.context);
  assert.equal(h.elements.get('fetchDate').value, '2026-10-15');
  assert.equal(Number(h.elements.get('fetchSecond').value), 1);
  assert.equal(Number(h.elements.get('fetchMs').value), 250);
});
test('公式にない日付・席名をフォームに入れても実行できない', () => {
  const h = harness();
  const values = { ...cfg, performanceDateIso: '2026-10-15', fetchDate: '2026-10-15', fetchHour: '14', fetchMinute: '0', fetchSecond: '0', fetchMs: '100', openDelaySeconds: '3' };
  h.context.FormData = function () { return Object.entries(values); };
  h.context.officialEntry = { name: cfg.receptionName, dates: [{ iso: '2026-10-14' }], seats: ['指定席'] };
  vm.runInContext('receptionEntries = [officialEntry]', h.context);
  assert.throws(() => vm.runInContext('readSettings()', h.context), /公演日/);
  values.performanceDateIso = '2026-10-14';
  assert.throws(() => vm.runInContext('readSettings()', h.context), /席種/);
});
test('スマホのスクロール時刻選択とPCの数字入力が同じ時刻に同期する', () => {
  const h = harness();
  vm.runInContext("$('openDelaySeconds').value = '3'; restoreTime('fetch', '2026-10-15T14:20:30.100+09:00'); updateTimeSummaries(); chooseWheel('Minute', 25)", h.context);
  assert.equal(Number(h.elements.get('fetchMinute').value), 25);
  assert.equal(h.elements.get('wheelMinute').scrollTop, 1000);
  assert.equal(h.elements.get('open-time-view').textContent, '14:25:33.100');
  assert.equal(h.elements.get('wheelHour').children.length, 24);
  assert.equal(h.elements.get('wheelSecond').children.length, 60);
});

test('「今日」を繰り返し押しても時刻ホイール・イベントが増えない', () => {
  const h = harness();
  const today = h.elements.get('fetch-today');
  today.listeners.click[0](); today.listeners.click[0]();
  assert.equal(h.elements.get('wheelHour').children.length, 24);
  assert.equal(h.elements.get('wheelMinute').children.length, 60);
  assert.equal(h.elements.get('tourUrl').listeners.input.length, 1);
});
test('チケットぴあは外部HTMLを取得せず、確認時は申込リンクだけを表示する', async () => {
  const pia = 'https://w.pia.jp/t/example/';
  const h = harness({tourHtml: block(pia)});
  await h.run(true);
  assert.equal(h.events.filter(event => event[0] === 'fetch').length, 1);
  assert.ok(!h.events.some(event => event[0] === 'open'));
  assert.equal(h.elements.get('candidates').children[0].children[0].href, pia);
  assert.match(h.elements.get('selected-seat').textContent, /チケットぴあ/);
});
test('チケットぴあの予約移動も指定時刻まで待ち、席の自動選択とは表示しない', async () => {
  const pia = 'https://w.pia.jp/t/example/';
  const h = harness({tourHtml: block(pia)});
  await h.run();
  assert.deepEqual(h.events.at(-1), ['open', pia, 200]);
  assert.match(h.elements.get('detail').textContent, /チケットぴあで選択/);
});
