const INTERVAL_MS = 100;
const LOOKAHEAD = 0.3;

/** Lookahead scheduler: a 100 ms timer hands out windows of context time to fill with notes. */
export class Scheduler {
  private readonly ctx: BaseAudioContext;
  private readonly fill: (now: number, until: number) => void;
  private timer = 0;

  constructor(ctx: BaseAudioContext, fill: (now: number, until: number) => void) {
    this.ctx = ctx;
    this.fill = fill;
  }

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), INTERVAL_MS);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  private tick(): void {
    const now = this.ctx.currentTime;
    this.fill(now, now + LOOKAHEAD);
  }
}
