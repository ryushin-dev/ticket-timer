import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context = { URL, console };
vm.createContext(context);
vm.runInContext(readFileSync(new URL('../src/core.js', import.meta.url), 'utf8'), context);
context.tourHtml = readFileSync(new URL('fixtures/tour-20261014.html', import.meta.url), 'utf8');
context.entryHtml = readFileSync(new URL('fixtures/entry-20261014.html', import.meta.url), 'utf8');
test('2026/10/14の公式HTMLから機材開放受付と10/15指定席を取得する', () => {
  const entry = vm.runInContext(`extractEntry(tourHtml, {
    tourUrl: 'https://mrsgreenapple.com/feature/ringojamtour_shadows',
    receptionName: '千葉(10)月公演 OFFICIAL FAN CLUB「Ringo Jam」機材開放当日引換券販売(先着)'
  })`, context);
  assert.match(entry.url, /ed275d9fcec6465c7c3f95f3df92696a/);
  const info = vm.runInContext('extractReception(entryHtml)', context);
  assert.equal(info.links.length, 6);
  context.links = info.links;
  const selected = vm.runInContext("selectTicket(links, { performanceDate: '10/15', seatName: '指定席' })", context);
  assert.equal(new URL(selected.url).searchParams.get('precede'), '24');
  assert.equal(selected.date, '10/15（木）'); assert.equal(selected.seat, '指定席');
});
test('公式の受付一覧は今回と終了済みの前回を区別して表示する', () => {
  const entries = vm.runInContext("listReceptions(tourHtml, 'https://mrsgreenapple.com/feature/ringojamtour_shadows')", context);
  const equipment = entries.find(e => e.name.includes('機材開放'));
  const previous = entries.find(e => e.name.includes('直前追加'));
  assert.equal(equipment.buttonLabel, 'お申し込みはこちら');
  assert.match(previous.buttonLabel, /受付終了/);
  assert.notEqual(equipment.url, previous.url);
});

test('対象席種・対象公演・販売開始を公式の受付ブロック内だけから読み取る', () => {
  const entries = vm.runInContext("listReceptions(tourHtml, 'https://mrsgreenapple.com/feature/ringojamtour_shadows', 2026)", context);
  assert.equal(entries.length, 2);
  const previous = entries.find(entry => entry.name.includes('直前追加'));
  assert.deepEqual(Array.from(previous.seats), ['注釈付き指定席', '注釈付き着席指定席']);
  assert.deepEqual(Array.from(previous.dates, date => date.iso), ['2026-10-14', '2026-10-15']);
  assert.equal(previous.startAt, '2026-10-12T14:00:00.000+09:00');
  assert.deepEqual(Array.from(entries.find(entry => entry.name.includes('機材開放')).seats), ['指定席', '着席指定席', '注釈付き指定席']);
  assert.ok(entries.every(entry => !entry.seats.some(seat => seat.includes('顔写真'))));
});
test('抽選受付を除外し、リンク未公開の先着受付は事前設定できる', () => {
  context.extraHtml = `<meta name="description" content="2027年開幕"><h3 class="slide-toggle">先行（抽選）</h3><h4>対象席種</h4><div>・指定席</div><a class="common-btn green-btn" href="/feature/lottery">申し込み</a><h3 class="slide-toggle">追加販売（先着）</h3><h4>受付期間</h4><div>2027年1月2日(土) 10:30〜1月3日(日)23:59</div><h4>対象公演</h4><div>1月5日(火) 18:00</div><h4>対象席種</h4><div>【追加販売】<br>・立見<br>・着席指定席<ul class="note"><li>・顔写真をご登録ください</li></ul></div><a class="common-btn green-btn" href="">未公開</a>`;
  const entries = vm.runInContext("listReceptions(extraHtml, 'https://mrsgreenapple.com/feature/tour', 2026)", context);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].unpublished, true);
  assert.deepEqual(Array.from(entries[0].seats), ['立見', '着席指定席']);
  assert.equal(entries[0].dates[0].iso, '2027-01-05');
  assert.equal(entries[0].startAt, '2027-01-02T10:30:00.000+09:00');
});

test('ゼンジン公式HTMLから先着3受付・エリア席・対象日・開始日時を取得する', () => {
  context.zenjinHtml = readFileSync(new URL('fixtures/zenjin-20261014.html', import.meta.url), 'utf8');
  const entries = vm.runInContext("listReceptions(zenjinHtml, 'https://mrsgreenapple.com/feature/zenjinmito_2026_ticket')", context);
  assert.equal(entries.length, 3);
  const july = entries.find(entry => entry.name.includes('7月'));
  const may = entries.find(entry => entry.name.includes('5月'));
  const april = entries.find(entry => entry.name.includes('4月'));
  assert.equal(july.destination, 'official'); assert.match(july.url, /85bdd9dfe796c65f3fe369fd5f0725ed/);
  assert.deepEqual(Array.from(july.dates, date => date.iso), ['2026-07-04', '2026-07-05']);
  assert.equal(july.startAt, '2026-07-03T17:00:00.000+09:00');
  assert.equal(july.seats.length, 5); assert.ok(july.seats.includes('注釈付きアリーナエリア'));
  assert.equal(may.seats.length, 4); assert.equal(may.startAt, '2026-05-03T14:00:00.000+09:00');
  assert.equal(april.destination, 'pia'); assert.equal(april.seats.length, 6);
  assert.deepEqual(Array.from(april.dates, date => date.iso), ['2026-04-18', '2026-04-19']);
  assert.equal(april.startAt, '2026-04-17T19:30:00.000+09:00');
});
