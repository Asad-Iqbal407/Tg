import { BaseGame } from '../base';

/** Placeholder until the real game is written. */
export class BombSquadGame extends BaseGame {
  protected tick(_dt: number): void {}

  render(): void {
    this.ctx.fillStyle = '#1a2b1f';
    this.ctx.fillRect(0, 0, this.W, this.H);
  }
}
