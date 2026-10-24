import { cellsOf, type Kind, KINDS, type Piece, type Rot } from './pieces';

/** Columns in the well. */
export const COLS = 10;
/** Rows in the well, including the buffer above the playfield where pieces spawn. */
export const ROWS = 22;
/** Buffer rows at the top. Locking a piece into them tops the run out. */
export const HIDDEN_ROWS = 2;
/** Rows of the visible playfield. */
export const VISIBLE_ROWS = ROWS - HIDDEN_ROWS;

/** The locked stack of the well. */
export class Board {
  /** Row-major from the top: 0 is empty, otherwise 1 + the index of the piece kind in KINDS. */
  readonly cells = new Uint8Array(COLS * ROWS);

  /** Whether a piece of this shape at (x, y) lies inside the well and overlaps no locked cell. */
  fitsAt(kind: Kind, rot: Rot, x: number, y: number): boolean {
    for (const o of cellsOf(kind, rot)) {
      const cx = x + o.x;
      const cy = y + o.y;
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return false;
      if (this.cells[cy * COLS + cx] !== 0) return false;
    }
    return true;
  }

  fits(p: Piece): boolean {
    return this.fitsAt(p.kind, p.rot, p.x, p.y);
  }

  /** How many rows the piece can fall from where it is before it touches something. */
  dropDistance(p: Piece): number {
    let d = 0;
    while (this.fitsAt(p.kind, p.rot, p.x, p.y + d + 1)) d++;
    return d;
  }

  /** Whether any cell of the piece lies in the buffer rows. */
  inBuffer(p: Piece): boolean {
    return cellsOf(p.kind, p.rot).some((o) => p.y + o.y < HIDDEN_ROWS);
  }

  /** Writes the piece's cells into the stack. */
  place(p: Piece): void {
    const code = KINDS.indexOf(p.kind) + 1;
    for (const o of cellsOf(p.kind, p.rot)) this.cells[(p.y + o.y) * COLS + p.x + o.x] = code;
  }

  /** Rows where every column is filled, top first. */
  fullRows(): number[] {
    const full: number[] = [];
    for (let y = 0; y < ROWS; y++) {
      let filled = true;
      for (let x = 0; x < COLS; x++) {
        if (this.cells[y * COLS + x] === 0) {
          filled = false;
          break;
        }
      }
      if (filled) full.push(y);
    }
    return full;
  }

  /** The `count` highest rows that hold any block, highest first. */
  highestRows(count: number): number[] {
    const rows: number[] = [];
    for (let y = 0; y < ROWS && rows.length < count; y++) {
      for (let x = 0; x < COLS; x++) {
        if (this.cells[y * COLS + x] !== 0) {
          rows.push(y);
          break;
        }
      }
    }
    return rows;
  }

  /** Removes the given rows and lets everything above them drop down. */
  removeRows(rows: readonly number[]): void {
    const gone = new Set(rows);
    let dst = ROWS - 1;
    for (let src = ROWS - 1; src >= 0; src--) {
      if (gone.has(src)) continue;
      if (dst !== src) this.cells.copyWithin(dst * COLS, src * COLS, (src + 1) * COLS);
      dst--;
    }
    this.cells.fill(0, 0, (dst + 1) * COLS);
  }
}
