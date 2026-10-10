import { BaseGame } from '../base';

/** Placeholder until the real game is written. */
export class SnakeGame extends BaseGame {
  protected tick(_dt: number): void {}

  render(): void {
    this.ctx.fillStyle = '#0b1f12';
    this.ctx.fillRect(0, 0, this.W, this.H);
  }
}
