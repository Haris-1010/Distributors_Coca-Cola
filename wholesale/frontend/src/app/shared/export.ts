import { int, money } from '../core/util';

export interface ExportColumn {
  key: string;
  label: string;
  type?: 'text' | 'money' | 'int' | 'number' | 'date' | 'percent';
}

type Row = Record<string, unknown>;

function cellText(v: unknown, type: ExportColumn['type']): string {
  if (v === null || v === undefined || v === '') return '';
  switch (type) {
    case 'money': return money(Number(v));
    case 'int': return int(Number(v));
    case 'percent': return `${Number(v).toFixed(1)}%`;
    case 'date': { const d = new Date(String(v)); return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB'); }
    default: return String(v);
  }
}

function fileName(title: string, ext: string): string {
  return `${title.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

/** Real .xlsx with numeric cells (so Excel can sum them). Library is loaded only when used. */
export async function exportExcel(title: string, columns: ExportColumn[], rows: Row[]): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file');
  const header = columns.map(c => ({ value: c.label, fontWeight: 'bold' as const }));
  const body = rows.map(r => columns.map(c => {
    const v = r[c.key];
    if (v === null || v === undefined || v === '') return null;
    if (c.type === 'money' || c.type === 'number' || c.type === 'percent') return { type: Number, value: Number(v), format: '#,##0.00' };
    if (c.type === 'int') return { type: Number, value: Number(v), format: '#,##0' };
    if (c.type === 'date') { const d = new Date(String(v)); return isNaN(d.getTime()) ? { type: String, value: String(v) } : { type: Date, value: d, format: 'dd/mm/yyyy' }; }
    return { type: String, value: String(v) };
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeXlsxFile([header, ...body] as any, {
    fileName: fileName(title, 'xlsx'),
    columns: columns.map(c => ({ width: c.type === 'text' || !c.type ? 26 : 14 })),
  });
}

/** A4 landscape PDF table with title and date range. */
export async function exportPdf(title: string, subtitle: string, columns: ExportColumn[], rows: Row[], company = ''): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(15);
  doc.setTextColor(11, 74, 143);
  doc.text(title, 40, 44);
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text([company, subtitle, `Printed ${new Date().toLocaleString('en-GB')}`].filter(Boolean).join('  ·  '), 40, 60);
  autoTable(doc, {
    startY: 74,
    head: [columns.map(c => c.label)],
    body: rows.map(r => columns.map(c => cellText(r[c.key], c.type))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [11, 74, 143] },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, { halign: c.type && c.type !== 'text' && c.type !== 'date' ? 'right' : 'left' }])),
  });
  doc.save(fileName(title, 'pdf'));
}
