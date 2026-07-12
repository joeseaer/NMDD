import { escapeHtml, normalizeClipboardText } from './htmlUtils';

export interface DelimitedTable {
  rows: string[][];
  columnCount: number;
}

/** Parses Excel/Sheets TSV, including quoted tabs, newlines, and doubled quotes. */
export const parseTsv = (input: string): DelimitedTable | null => {
  const value = normalizeClipboardText(input);
  if (!value.includes('\t')) return null;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === '\t' && !quoted) {
      row.push(field);
      field = '';
      continue;
    }
    if (character === '\n' && !quoted) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += character;
  }
  if (quoted) return null;
  row.push(field);
  rows.push(row);

  while (rows.length > 1 && rows[rows.length - 1].every(cell => cell === '')) rows.pop();
  const columnCount = rows[0]?.length || 0;
  if (columnCount < 2 || rows.some(current => current.length !== columnCount)) return null;
  // A leading/trailing single tab is usually indentation. Two populated cells
  // are also a common one-row Excel/Sheets selection and should stay a table.
  if (rows.length === 1 && columnCount === 2 && rows[0].some(cell => cell === '')) return null;
  return { rows, columnCount };
};

const cellHtml = (value: string) => escapeHtml(value).replace(/\n/g, '<br>');

export const tsvToHtml = (table: DelimitedTable): string => {
  const [header = [], ...body] = table.rows;
  const headerHtml = `<thead><tr>${header.map(cell => `<th>${cellHtml(cell)}</th>`).join('')}</tr></thead>`;
  const bodyHtml = body.length
    ? `<tbody>${body.map(row => `<tr>${row.map(cell => `<td>${cellHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '<tbody></tbody>';
  return `<table>${headerHtml}${bodyHtml}</table>`;
};
