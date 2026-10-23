import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { assemble } from '../scripts/build.mjs';
const model = readFileSync(new URL('../src/practice-model.js', import.meta.url), 'utf8');
function runModel() { let now = 0; const ctx = vm.createContext({performance: {now: () => now}}); const Run = vm.runInContext(model + '\nTicketPracticeRun', ctx); return {run: new Run(), advance(ms) {now += ms;}}; }
test('写真の順序で進み、支払い内容の確認へを押した瞬間に時計を止める', () => {
 const h = runModel(); h.run.start({waitSeconds: 3}); h.advance(2999); assert.equal(h.run.tick(), false); h.advance(51); assert.equal(h.run.tick(), true);
 for (const stage of ['login','registration','ticket','order-confirm','payment']) {h.advance(1000); h.run.tap(); assert.equal(h.run.advance(stage), true);}
 const r=h.run.result(); assert.equal(r.status,'complete'); assert.equal(r.totalMs,8050); assert.equal(r.waitMs,3050); assert.equal(r.operationMs,5000); assert.equal(r.clicks,5); assert.equal(r.laps.length,6);
 h.advance(9000); assert.equal(h.run.elapsed(),8050);
});
test('ログイン済みでも登録情報を確認し、中止後は最初から再開できる', () => {
 const h=runModel(); h.run.start({waitSeconds:0,skipLogin:true}); h.run.tick(); assert.equal(h.run.stage,'registration'); assert.equal(h.run.advance('ticket'),false);
 h.advance(2000); h.run.cancel(); h.advance(10000); assert.equal(h.run.elapsed(),2000); h.run.start(); assert.equal(h.run.elapsed(),0);
 for(const waitSeconds of [-1,61,NaN,Infinity]) assert.throws(()=>h.run.start({waitSeconds}),/0〜60秒/);
});
async function uiHarness(options={}) {
 let now=0, calls=0; const elements=new Map(), bodyClasses=new Set();
 const get=id=>{if(!elements.has(id))elements.set(id,{id,value:'',checked:false,hidden:false,dataset:{},style:{},listeners:{},textContent:'',innerHTML:'',disabled:false,contentWindow:{postMessage(){}},addEventListener(type,cb){(this.listeners[type] ||= []).push(cb);},setAttribute(n,v){this[n]=v;},scrollIntoView(){},focus(){},querySelector(){return null;},querySelectorAll(){return [];}});return elements.get(id);};
 get('practice-wait').value='0';get('practice-prefill').checked=options.prefill!==false;
 const context=vm.createContext({$:get,job:null,Date,performance:{now:()=>now},document:{activeElement:null,body:{classList:{add(x){bodyClasses.add(x);},remove(x){bodyClasses.delete(x);}}}},setInterval(){return 1;},clearInterval(){},fetch(){calls++;throw Error('forbidden');},location:{assign(){calls++;throw Error('forbidden');}}});
 const html=await assemble(), scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];vm.runInContext(scripts[2][1]+'\n'+scripts[3][1],context);
 return {context,get,bodyClasses,start(){context.startPractice();vm.runInContext('practiceRun.tick() && renderPractice()',context);},stage(){return vm.runInContext('practiceRun.stage',context);},status(){return vm.runInContext('practiceRun.status',context);},action(name){get('practice-stage').listeners.click[0]({target:{closest(){return {dataset:{practiceAction:name}};}}});},change(id,value,name){get('practice-stage').listeners.change[0]({target:{id,value,name}});},advance(ms){now+=ms;},calls(){return calls;}};
}
async function atTicket(){const h=await uiHarness();h.start();h.get('practice-demo-id').value='demo';h.get('practice-demo-password').value='dummy';h.action('login-next');h.action('registration-next');return h;}
test('公演・席種・枚数は未選択から始まり、2枚で同行者欄を表示し友達選択を行う',async()=>{
 const h=await atTicket();assert.equal(h.stage(),'ticket');assert.match(h.get('practice-stage').innerHTML,/option value="" selected>選択してください/);assert.match(h.get('practice-stage').innerHTML,/id="practice-quantity"[^>]*><\/select>/);assert.doesNotMatch(h.get('practice-stage').innerHTML,/一緒に行く人/);
 h.action('ticket-next');assert.equal(h.stage(),'ticket');h.change('practice-performance','29');h.action('ticket-next');assert.equal(h.stage(),'ticket');h.change('practice-seat','1642681');h.change('practice-quantity','2');assert.match(h.get('practice-stage').innerHTML,/ご登録のメールアドレスまたはPlus member ID/);assert.doesNotMatch(h.get('practice-stage').innerHTML,/role="dialog"/);
 h.action('ticket-next');assert.equal(h.stage(),'ticket');h.action('friend-open');assert.match(h.get('practice-stage').innerHTML,/role="dialog"/);h.change('','demo-a','practice-demo-friend');h.action('friend-confirm');assert.match(h.get('practice-stage').innerHTML,/選択を取り消す/);h.action('ticket-next');assert.equal(h.stage(),'order-confirm');assert.match(h.get('practice-stage').innerHTML,/支払い内容の確認へ/);
 h.action('order-next');assert.equal(h.stage(),'payment');assert.doesNotMatch(h.get('practice-stage').innerHTML,/ご登録のクレジットカード|tp-pay-detail/);assert.match(h.get('practice-stage').innerHTML,/name="practice-pay-method" value="card">/);h.action('payment-next');assert.equal(h.stage(),'payment');assert.match(h.get('practice-error').textContent,/支払い方法を選択/);h.change('','card','practice-pay-method');assert.equal(h.stage(),'payment');assert.match(h.get('practice-stage').innerHTML,/ご登録のクレジットカード/);h.advance(1500);h.action('payment-next');assert.equal(h.stage(),'payment-confirm');assert.equal(h.status(),'complete');assert.equal(h.get('practice-session').hidden,false);assert.match(h.get('practice-stage').innerHTML,/支払い内容を確認してください/);h.action('finish-practice');assert.equal(h.get('practice-result').hidden,false);assert.equal(h.get('practice-session').hidden,true);assert.equal(h.bodyClasses.has('practice-active'),false);assert.equal(h.calls(),0);
});
test('申込修正で選択を保ち、公演変更時は席・枚数をリセットする',async()=>{
 const h=await atTicket();h.change('practice-performance','29');h.change('practice-seat','1642681');h.change('practice-quantity','1');h.action('ticket-next');h.advance(1000);h.action('order-back');assert.equal(h.stage(),'ticket');assert.match(h.get('practice-stage').innerHTML,/value="29" selected/);assert.match(h.get('practice-stage').innerHTML,/value="1" selected/);h.change('practice-performance','');assert.match(h.get('practice-stage').innerHTML,/id="practice-quantity"[^>]*><\/select>/);
});
test('中止で友達一覧も閉じ、全面表示を解除してイメトレ設定へ戻る',async()=>{
 const h=await atTicket();assert.equal(h.bodyClasses.has('practice-active'),true);h.change('practice-performance','29');h.change('practice-seat','1642681');h.change('practice-quantity','2');h.action('friend-open');h.get('practice-stop').listeners.click[0]();assert.equal(h.get('practice-session').hidden,true);assert.equal(h.get('practice-stage').innerHTML,'');assert.equal(h.bodyClasses.has('practice-active'),false);assert.equal(h.get('panel-practice').hidden,false);assert.equal(h.get('practice-result').hidden,true);h.start();assert.equal(h.stage(),'login');assert.equal(h.calls(),0);
});
test('本予約中は開始せず、独立した同意画面を含めない',async()=>{
 const h=await uiHarness({prefill:false});h.context.job={};h.start();assert.equal(h.status(),'idle');h.context.job=null;h.start();h.action('login-next');assert.equal(h.stage(),'login');h.get('practice-demo-id').value='demo';h.get('practice-demo-password').value='dummy';h.action('login-next');assert.equal(h.stage(),'registration');const html=await assemble();assert.doesNotMatch(html,/practice-consent|practice-agree/);assert.match(html,/#practice-session\{position:fixed;inset:0/);assert.match(html,/\.practice-toolbar\{position:fixed;right:/);assert.equal(h.calls(),0);
});
test('タブ切替で設定画面を残す',async()=>{const h=await uiHarness();h.context.selectAppTab('practice');assert.equal(h.get('panel-reserve').hidden,true);assert.equal(h.get('panel-practice').hidden,false);h.context.selectAppTab('guide');assert.equal(h.get('panel-guide').hidden,false);h.context.selectAppTab('reserve');assert.equal(h.get('panel-reserve').hidden,false);});

test('新規カードは入力漏れで進まず、ダミー入力後は確認に進み、戻ると修正できる',async()=>{
 const h=await atTicket();h.change('practice-performance','29');h.change('practice-seat','1642681');h.change('practice-quantity','1');h.action('ticket-next');h.action('order-next');h.change('','card','practice-pay-method');h.change('','new','practice-card-choice');h.action('payment-next');assert.equal(h.stage(),'payment');
 h.get('practice-fill').listeners.click[0]();h.advance(1000);h.action('payment-next');assert.equal(h.stage(),'payment-confirm');assert.equal(h.status(),'complete');h.advance(9000);h.action('confirm-back');assert.equal(h.stage(),'payment');assert.equal(h.status(),'running');assert.match(h.get('practice-stage').innerHTML,/4242424242424242/);h.advance(500);h.action('payment-next');assert.equal(h.status(),'complete');assert.equal(vm.runInContext('practiceRun.result().operationMs',h.context),1500);assert.equal(h.calls(),0);
});
test('練習の保存カード削除はキャンセルでき、削除後は新規カード欄になる',async()=>{
 const h=await atTicket();h.change('practice-performance','29');h.change('practice-seat','1642681');h.change('practice-quantity','1');h.action('ticket-next');h.action('order-next');h.change('','card','practice-pay-method');h.action('delete-card');assert.match(h.get('practice-stage').innerHTML,/role="dialog"/);h.action('delete-card-cancel');assert.match(h.get('practice-stage').innerHTML,/ご登録のクレジットカード/);h.action('delete-card');h.action('delete-card-confirm');assert.doesNotMatch(h.get('practice-stage').innerHTML,/ご登録のクレジットカード/);assert.match(h.get('practice-stage').innerHTML,/id="practice-card-number"/);assert.equal(h.calls(),0);
});

test('SHADOWSは支払い方法未選択から開き、登録カード選択済みで特別販売利用料を含む',async()=>{
 const h=await atTicket();h.change('practice-performance','29');h.change('practice-seat','1642681');h.change('practice-quantity','2');h.action('friend-open');h.change('','demo-a','practice-demo-friend');h.action('friend-confirm');h.action('ticket-next');h.action('order-next');h.change('','card','practice-pay-method');
 const payment=h.get('practice-stage').innerHTML;
 assert.doesNotMatch(payment,/コンビニ|セブンイレブン|type="checkbox"/);
 assert.match(payment,/name="practice-pay-method" value="card" checked/);
 assert.match(payment,/name="practice-card-choice" value="saved" checked/);
 assert.match(payment,/特別販売利用料（税込）/);assert.match(payment,/¥1,320/);assert.match(payment,/¥32,310/);
 h.change('','convenience','practice-pay-method');assert.equal(vm.runInContext('practiceData.payMethod',h.context),'card');
 h.action('payment-next');assert.equal(h.stage(),'payment-confirm');assert.match(h.get('practice-stage').innerHTML,/¥32,310/);assert.equal(h.calls(),0);
});

test('公演・席種メニューの2行目が選択枠の中央に重なる',async()=>{
 const h=await uiHarness();
 for (const height of [30,45,60]) {
   const top=vm.runInContext(`practiceMenuTop({top:200,height:${height}})`,h.context);
   assert.equal(top+5+28+14,200+height/2);
 }
});

test('ツアーモードは有効なリロードから計測し、待合室で停止する',async()=>{
 const h=await uiHarness();h.get('practice-from-tour').checked=true;h.get('practice-launch-seconds').value='2';h.get('practice-skip-login').checked=true;h.start();
 assert.equal(h.stage(),'tour');h.action('tour-apply');assert.equal(h.stage(),'tour');
 h.advance(1999);h.get('practice-reload').listeners.click[0]();assert.equal(vm.runInContext('practiceRun.applicationVisible',h.context),false);
 h.advance(1);vm.runInContext('updatePracticeClocks()',h.context);assert.equal(vm.runInContext('practiceRun.applicationVisible',h.context),false);
 h.advance(100);h.get('practice-reload').listeners.click[0]();assert.equal(vm.runInContext('practiceRun.applicationVisible',h.context),true);
 h.advance(400);h.action('tour-apply');assert.equal(h.stage(),'reception');h.advance(600);vm.runInContext("advancePractice('reception')",h.context);assert.equal(h.stage(),'queue');assert.equal(h.status(),'complete');h.advance(5000);vm.runInContext('practiceRun.tick() && renderPractice()',h.context);assert.equal(h.stage(),'queue');
 assert.equal(vm.runInContext('practiceRun.result().operationMs',h.context),1000);assert.equal(h.calls(),0);
 h.get('practice-stop').listeners.click[0]();h.start();assert.equal(h.stage(),'tour');assert.equal(vm.runInContext('practiceRun.applicationVisible',h.context),false);
});
test('再リロードで計測をリセットせず、待合室到着後の時間を含めない',()=>{
 const h=runModel();h.run.start({fromTour:true,launchSeconds:1,waitSeconds:1});h.advance(999);assert.equal(h.run.reloadTour(),false);assert.equal(h.run.elapsed(),0);h.advance(1);assert.equal(h.run.reloadTour(),true);h.advance(200);assert.equal(h.run.reloadTour(),true);assert.equal(h.run.elapsed(),200);h.run.advance('tour');h.advance(300);h.run.advance('reception');assert.equal(h.run.stage,'queue');assert.equal(h.run.status,'complete');h.advance(10000);assert.equal(h.run.elapsed(),500);assert.equal(h.run.tick(),false);
 for(const launchSeconds of [-1,301,NaN])assert.throws(()=>h.run.start({fromTour:true,launchSeconds}),/0〜300秒/);
});
test('再現ページは元のCSS・画像を内蔵し、外部通信・本物の購入へ遷移しない',()=>{
 const pages=JSON.parse(readFileSync(new URL('../src/assets/shadows-reference/pages.json',import.meta.url),'utf8'));
 for(const html of Object.values(pages)){
  assert.match(html,/connect-src 'none'/);assert.match(html,/form-action 'none'/);
  assert.doesNotMatch(html,/<script[^>]+src=|<iframe|src=["']https?:/i);
  assert.match(html,/data:image/);
 }
 assert.match(pages.tour,/opacity: 0.5/);assert.match(pages.reception,/確認しました/);assert.match(pages.reception,/practice-reception-apply/);
});

test('SHADOWSの申込ボタンは複数ともタップでき、開始前は進まずリロード後に進む',()=>{
 const pages=JSON.parse(readFileSync(new URL('../src/assets/shadows-reference/pages.json',import.meta.url),'utf8'));
 const script=[...pages.tour.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
 const listeners={},messages=[],attrs=new Map();
 const buttons=[0,1].map(id=>({id,textContent:'お申し込みはこちら',style:{},setAttribute(k,v){attrs.set(`${id}:${k}`,v);}}));
 const sections=buttons.map(button=>({querySelector(){return{textContent:'北海道公演 先着'};},querySelectorAll(){return[button];}}));
 const parent={postMessage(message){messages.push(message);}};
 const document={querySelectorAll(selector){return selector==='.ticket-schedule > li'?sections:[];},querySelector(){return null;},addEventListener(name,cb){listeners[name]=cb;}};
 vm.runInNewContext(script,{document,parent,window:{addEventListener(name,cb){listeners[name]=cb;}}});
 for(const button of buttons){listeners.click({target:{closest(selector){return selector==='a'?button:null;}},preventDefault(){}});}
 assert.equal(messages.filter(x=>x.type==='practice-tour-apply').length,0);
 listeners.message({source:parent,data:{type:'practice-unlock',enabled:true}});
 for(const button of buttons){listeners.click({target:{closest(selector){return selector==='a'?button:null;}},preventDefault(){}});assert.equal(button.style.opacity,'1');}
 assert.equal(messages.filter(x=>x.type==='practice-tour-apply').length,2);
 assert.match(pages.tour,/name="viewport" content="width=device-width,initial-scale=1"/);
 assert.match(pages.tour,/id="practice-mobile-reference"/);
 assert.match(pages.reception,/id="practice-reception-mobile"/);
});

test('申込受付の背景とポップアップは保存HTMLの寸法を使用する',()=>{
 const pages=JSON.parse(readFileSync(new URL('../src/assets/shadows-reference/pages.json',import.meta.url),'utf8'));
 assert.doesNotMatch(pages.reception,/practice-popup-width|max-width:960px/);
 assert.match(pages.reception,/購入注意事項を確認する/);
 const rules=[...pages.reception.matchAll(/\.popup_entry \.popup_inner\s*\{([^}]*)\}/g)].map(m=>m[1]);
 assert.ok(rules.some(rule=>/padding:\s*45px/.test(rule)&&/border-radius:\s*32px/.test(rule)&&/max-height:\s*85vh/.test(rule)));
 assert.ok(rules.some(rule=>/height:\s*100dvh/.test(rule)&&/padding:\s*48px 16px 20px/.test(rule)));
 assert.match(pages.reception,/\.p-top \.p-section\.entry::before\s*\{[^}]*background:\s*url\("data:image\/png;base64,/);
});
