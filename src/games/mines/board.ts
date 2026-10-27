import type { Rng } from '../../core/rng';

export interface Cell {
  mine: boolean;
  /** Mines among the eight neighbours. */
  near: number;
  open: boolean;
  flag: boolean;
}

/** A Minesweeper board, `cols` x `rows`, row-major. Mines are laid on the first dig, so it is always safe. */
export class Board {
  readonly cells: Cell[];
  laid = false;

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly mines: number,
  ) {
    this.cells = Array.from({ length: cols * rows }, () => ({
      mine: false,
      near: 0,
      open: false,
      flag: false,
    }));
  }

  index(c: number, r: number): number {
    return r * this.cols + c;
  }

  /** The (up to eight) cells around cell i. */
  around(i: number): number[] {
    const c = i % this.cols;
    const r = Math.floor(i / this.cols);
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const x = c + dc;
        const y = r + dr;
        if (x >= 0 && x < this.cols && y >= 0 && y < this.rows) out.push(this.index(x, y));
      }
    }
    return out;
  }

  /** Lays the mines anywhere except cell `safe` and its neighbours, then counts every cell's neighbours. */
  lay(rng: Rng, safe: number): void {
    const keepOut = new Set([safe, ...this.around(safe)]);
    const spots = rng.shuffle(this.cells.map((_, i) => i).filter((i) => !keepOut.has(i)));
    for (const i of spots.slice(0, this.mines)) {
      const cell = this.cells[i];
      if (cell) cell.mine = true;
    }
    this.cells.forEach((cell, i) => {
      cell.near = this.around(i).filter((k) => this.cells[k]?.mine).length;
    });
    this.laid = true;
  }

  /**
   * Opens cell i. An empty cell (no mines near) opens its neighbours too, spreading across the empty area.
   * Returns the cells opened, or null when i was a mine. Flagged and open cells are left alone.
   */
  open(i: number): number[] | null {
    const start = this.cells[i];
    if (!start || start.open || start.flag) return [];
    if (start.mine) {
      start.open = true;
      return null;
    }
    const opened: number[] = [];
    const queue = [i];
    while (queue.length > 0) {
      const k = queue.pop() as number;
      const cell = this.cells[k];
      if (!cell || cell.open || cell.flag || cell.mine) continue;
      cell.open = true;
      opened.push(k);
      if (cell.near === 0) queue.push(...this.around(k));
    }
    return opened;
  }

  /**
   * Chording: on an open number whose flags around it match its count, opens every other neighbour at once.
   * Returns the cells opened, or null when a wrong flag let a mine open.
   */
  chord(i: number): number[] | null {
    const cell = this.cells[i];
    if (!cell || !cell.open || cell.near === 0) return [];
    const around = this.around(i);
    const flags = around.filter((k) => this.cells[k]?.flag).length;
    if (flags !== cell.near) return [];
    const opened: number[] = [];
    for (const k of around) {
      const got = this.open(k);
      if (got === null) return null;
      opened.push(...got);
    }
    return opened;
  }

  toggleFlag(i: number): boolean {
    const cell = this.cells[i];
    if (!cell || cell.open) return false;
    cell.flag = !cell.flag;
    return true;
  }

  /** True once every safe cell is open. */
  cleared(): boolean {
    return this.laid && this.cells.every((c) => c.mine || c.open);
  }

  flagsPlaced(): number {
    return this.cells.filter((c) => c.flag).length;
  }
}
