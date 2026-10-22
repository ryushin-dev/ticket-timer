// 写真で確認できる順序だけを再現する。通信や購入処理は持たない。
class TicketPracticeRun {
  constructor(clock = () => performance.now()) { this.clock = clock; this.status = 'idle'; this.stage = null; this.laps = []; this.clicks = 0; }
  start({ waitSeconds = 3, skipLogin = false, fromTour = false, launchSeconds = 10 } = {}) {
    if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 60) throw new Error('待合室の時間は0〜60秒で設定してください。');
    if (!Number.isFinite(launchSeconds) || launchSeconds < 0 || launchSeconds > 300) throw new Error('目標時刻までの時間は0〜300秒で設定してください。');
    this.fromTour = fromTour; this.launchSeconds = launchSeconds; this.applicationVisible = false;
    this.waitSeconds = waitSeconds; this.skipLogin = skipLogin;
    this.startedAt = this.clock(); this.enteredAt = this.startedAt; this.endedAt = null;
    this.stage = fromTour ? 'tour' : 'queue'; this.status = 'running'; this.laps = []; this.clicks = 0;
  }
  reloadTour() {
    if (this.status !== 'running' || this.stage !== 'tour') return false;
    this.applicationVisible = this.elapsed() >= this.launchSeconds * 1000;
    return this.applicationVisible;
  }
  tap() { if (this.status === 'running') this.clicks++; }
  elapsed() { return this.status === 'idle' ? 0 : Math.max(0, (this.endedAt ?? this.clock()) - this.startedAt); }
  stageElapsed() { return this.status !== 'running' ? 0 : Math.max(0, this.clock() - this.enteredAt); }
  advance(expectedStage) {
    if (this.status !== 'running' || this.stage !== expectedStage) return false;
    const next = { tour: this.applicationVisible ? 'reception' : null, reception: 'queue', queue: this.skipLogin ? 'registration' : 'login', login: 'registration', registration: 'ticket', ticket: 'order-confirm', 'order-confirm': 'payment', payment: 'payment-confirm' }[this.stage];
    if (!next) return false;
    const now = this.clock(); this.laps.push({ stage: this.stage, milliseconds: Math.max(0, now - this.enteredAt) });
    this.stage = next; this.enteredAt = now;
    if (next === 'payment-confirm') { this.status = 'complete'; this.endedAt = now; }
    return true;
  }
  backToTicket() { return this.back('order-confirm', 'ticket'); }
  back(expectedStage, nextStage) {
    if (this.status !== 'running' || this.stage !== expectedStage || ![['order-confirm','ticket'],['payment','order-confirm']].some(([a,b]) => a === expectedStage && b === nextStage)) return false;
    const now = this.clock(); this.laps.push({ stage: this.stage, milliseconds: Math.max(0, now - this.enteredAt) });
    this.stage = nextStage; this.enteredAt = now; return true;
  }
  resumePayment() {
    if (this.status !== 'complete' || this.stage !== 'payment-confirm') return false;
    const now = this.clock(); this.startedAt += now - this.endedAt;
    this.endedAt = null; this.stage = 'payment'; this.enteredAt = now; this.status = 'running'; return true;
  }
  tick() { if (this.stage === 'queue' && this.status === 'running' && this.stageElapsed() >= this.waitSeconds * 1000) return this.advance('queue'); return false; }
  cancel() { if (this.status === 'running') { this.endedAt = this.clock(); this.status = 'cancelled'; } }
  result() {
    let wait = this.laps.find(lap => lap.stage === 'queue')?.milliseconds ?? (this.stage === 'queue' ? this.elapsed() : 0);
    if (this.fromTour) wait += Math.min(this.launchSeconds * 1000, this.laps.find(lap => lap.stage === 'tour')?.milliseconds ?? (this.stage === 'tour' ? this.elapsed() : 0));
    return { status: this.status, totalMs: this.elapsed(), waitMs: wait, operationMs: Math.max(0, this.elapsed() - wait), clicks: this.clicks, laps: this.laps.map(lap => ({ ...lap })) };
  }
}
