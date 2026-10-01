// Minimal pipe-table syntax for long attachment tables:
//   || 表头A | 表头B
//   | 1 | 2
// Rows starting with || are header rows (repeated on each printed page).
export function parseTable(text = '') {
  const lines = text.split(/\r?\n/).filter((l) => /^\|{1,2}\s?/.test(l));
  if (lines.length < 2) return null;
  const rows = lines.map((l) => {
    const header = l.startsWith('||');
    const cells = l.replace(/^\|{1,2}/, '').split('|').map((c) => c.trim());
    return { header, cells };
  });
  return { headerRows: rows.filter((r) => r.header), rows };
}
