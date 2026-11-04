import type { Line, Piece } from './textLayout';

// Finds simple tables among a page's lines, from positions alone: consecutive
// rows split into cells, with clear vertical gutters running through all of
// them. Cells may be left-aligned, right-aligned, or centred, since columns are
// the x ranges the cells occupy, not shared left edges. Strict on purpose: a
// run that doesn't fit (wrapped or merged cells, prose in columns, a list, a
// form's label and answer rows) stays ordinary text.

/** Rows of cells; a cell is a Line of its pieces, null when empty. */
export type FoundTable = { start: number; end: number; rows: (Line | null)[][] };

const MIN_ROWS = 3;
const MAX_COLUMNS = 12;
// Pieces further apart than this (in text sizes) are separate cells.
const CELL_GAP = 1;
// The narrowest gutter between two columns, in text sizes.
const GUTTER = 0.5;
// Rows further apart than this (baseline to baseline) aren't one table.
const ROW_SPACING = 2.5;
// Cells this wordy on average are prose set in columns.
const MAX_MEAN_WORDS = 5;
const LIST_MARKER_ONLY = /^\s*([•◦▪▫■□●○‣⁃∙·\-–—*]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s*$/;

type Range = { left: number; right: number };

function asCell(pieces: Piece[], line: Line): Line {
  return {
    pieces,
    y: line.y,
    size: line.size,
    left: pieces[0].x,
    right: Math.max(...pieces.map((p) => p.x + p.width)),
  };
}

function splitCells(line: Line): Line[] {
  const cells: Piece[][] = [];
  line.pieces.forEach((piece, i) => {
    const previous = line.pieces[i - 1];
    if (previous && piece.x - (previous.x + previous.width) > piece.size * CELL_GAP) cells.push([piece]);
    else if (cells.length) cells.at(-1)!.push(piece);
    else cells.push([piece]);
  });
  return cells.map((pieces) => asCell(pieces, line));
}

/** The x ranges the cells occupy, with the ones that overlap merged. */
function columnRanges(rows: Line[][]): Range[] {
  const cells = rows.flat().sort((a, b) => a.left - b.left);
  const columns: Range[] = [];
  for (const cell of cells) {
    const last = columns.at(-1);
    if (last && cell.left - last.right < cell.size * GUTTER) last.right = Math.max(last.right, cell.right);
    else columns.push({ left: cell.left, right: cell.right });
  }
  return columns;
}

function cellText(cell: Line): string {
  return cell.pieces.map((p) => p.text).join(' ').trim();
}

function looksLikeTable(rows: Line[][], columns: Range[]): boolean {
  if (rows.length < MIN_ROWS || columns.length < 2 || columns.length > MAX_COLUMNS) return false;
  const cells = rows.flat();
  const words = cells.reduce((sum, cell) => sum + cellText(cell).split(/\s+/).length, 0);
  if (words / cells.length >= MAX_MEAN_WORDS) return false;
  if (columns.length === 2) {
    // A list with its markers set apart, or a form's labels and answers.
    if (rows.every((row) => row.length === 2 && LIST_MARKER_ONLY.test(cellText(row[0])))) return false;
    if (cells.some((cell) => cell.pieces.some((p) => p.fontName === ''))) return false;
  }
  return true;
}

export function findTables(lines: Line[]): FoundTable[] {
  const split = lines.map(splitCells);
  const tables: FoundTable[] = [];
  let i = 0;
  while (i < lines.length) {
    let end = i;
    let columns: Range[] = [];
    if (split[i].length >= 2) {
      columns = columnRanges([split[i]]);
      while (end + 1 < lines.length) {
        const next = end + 1;
        if (split[next].length < 2) break;
        if (lines[next].y - lines[end].y > Math.max(lines[next].size, lines[end].size) * ROW_SPACING) break;
        const grown = columnRanges(split.slice(i, next + 1));
        // Fewer columns means this row's cells run across a gutter: it doesn't belong.
        if (grown.length < columns.length || grown.length < 2) break;
        columns = grown;
        end = next;
      }
    }
    const rows = split.slice(i, end + 1);
    if (looksLikeTable(rows, columns)) {
      tables.push({
        start: i,
        end,
        rows: rows.map((row) => {
          const out: (Line | null)[] = columns.map(() => null);
          for (const cell of row) {
            const c = columns.findIndex((col) => cell.left >= col.left && cell.right <= col.right);
            out[c] = cell;
          }
          return out;
        }),
      });
      i = end + 1;
    } else {
      i++;
    }
  }
  return tables;
}
