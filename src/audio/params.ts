/**
 * Per-frame control of one AudioParam. Every change glides with setTargetAtTime (no zipper),
 * and near-identical targets are dropped so the automation timeline stays short.
 */
export class Smoothed {
  private readonly param: AudioParam;
  private readonly tau: number;
  private readonly eps: number;
  private last = Number.NaN;

  /** eps is absolute below 1 and relative above it, so it suits both gains and frequencies. */
  constructor(param: AudioParam, tau: number, eps = 0.002) {
    this.param = param;
    this.tau = tau;
    this.eps = eps;
  }

  set(value: number, t: number): void {
    if (Math.abs(value - this.last) <= this.eps * Math.max(1, Math.abs(this.last))) return;
    this.last = value;
    this.param.setTargetAtTime(value, t, this.tau);
  }
}
