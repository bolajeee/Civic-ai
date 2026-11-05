import type { compileIssueReport } from './issue-report-compilation';

type CompiledReport = Omit<ReturnType<typeof compileIssueReport>, 'liveDraft'> & {
  liveDraft: boolean;
  version?: { id: string; number: number; createdAt: string; createdBy: string;
    approval?: null | { approvedAt: string; approvedBy: string; reason: string } };
};
interface PdfLine { text: string; size?: number; bold?: boolean; gap?: number; keepWithNext?: boolean }

const ascii = (value: unknown) => String(value ?? '').replace(/[^\x20-\xFF]/g, '?');
const escapePdf = (value: string) => ascii(value).replace(/([\\()])/g, '\\$1');
const displayDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(value)) + ' WAT'
  : 'Unavailable';

function wrapped(text: string, width = 88): string[] {
  const words = ascii(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function add(lines: PdfLine[], text: string, options: Omit<PdfLine, 'text'> = {}) {
  const width = options.size && options.size >= 14 ? 62 : 88;
  wrapped(text, width).forEach((part, index) => lines.push({ text: part, ...options, gap: index ? 0 : options.gap }));
}

export function renderIssueReportPdf(report: CompiledReport): Buffer {
  const lines: PdfLine[] = [];
  add(lines, 'CivicAI Issue Report', { size: 18, bold: true, gap: 8 });
  add(lines, report.liveDraft
    ? 'LIVE DRAFT - NOT FORMALLY APPROVED'
    : report.version?.approval
      ? `FORMALLY APPROVED IMMUTABLE VERSION ${report.version.number}`
      : `IMMUTABLE VERSION ${report.version?.number ?? '?'} - NOT FORMALLY APPROVED`,
  { size: 11, bold: true, gap: 8 });
  add(lines, `${report.cluster.publicId} / ${report.cluster.category.label}`, { size: 15, bold: true, gap: 5 });
  add(lines, `Cluster status: ${report.cluster.status} | Review status: ${report.review.status}`);
  add(lines, `Compiled: ${displayDate(report.generatedAt)} | Current sources: ${report.cluster.reportCount}`, { gap: 9 });
  add(lines, `Observation window: ${displayDate(report.coverage.firstObservedAt)} - ${displayDate(report.coverage.lastObservedAt)}`);
  add(lines, `Coverage: ${report.coverage.withLocation} with GPS, ${report.coverage.withoutLocation} without GPS; ${report.coverage.withDescription} with descriptions, ${report.coverage.withoutDescription} without descriptions.`, { gap: 10 });

  if (report.version) add(lines, `Version created: ${displayDate(report.version.createdAt)} | Created by: ${report.version.createdBy}`, { gap: 9 });
  if (report.version?.approval) {
    add(lines, `Approved: ${displayDate(report.version.approval.approvedAt)} | Approved by: ${report.version.approval.approvedBy}`);
    add(lines, `Approval statement: ${report.version.approval.reason}`, { gap: 9 });
  }
  add(lines, 'Combined findings', { size: 13, bold: true, gap: 4, keepWithNext: true });
  for (const finding of report.findings) {
    add(lines, `${finding.text} [Sources: ${finding.sourceReportIds.join(', ') || 'none'}]`, { gap: 3 });
  }

  add(lines, 'Unresolved disagreements', { size: 13, bold: true, gap: 4, keepWithNext: true });
  if (!report.disagreements.length) add(lines, 'None detected by the compilation checks.');
  for (const item of report.disagreements) add(lines, `${item.summary} [Sources: ${item.sourceReportIds.join(', ')}]`, { gap: 3 });

  add(lines, 'Outstanding uncertainty', { size: 13, bold: true, gap: 4, keepWithNext: true });
  if (!report.uncertainties.length) add(lines, 'None detected by the compilation checks.');
  for (const item of report.uncertainties) add(lines, `${item.summary} [Sources: ${item.sourceReportIds.join(', ')}]`, { gap: 3 });

  add(lines, 'Evidence appendix', { size: 13, bold: true, gap: 5, keepWithNext: true });
  for (const source of report.evidenceAppendix) {
    add(lines, `${source.sourceReportId} / ${source.status}`, { size: 11, bold: true, gap: 3 });
    add(lines, `Submitted: ${displayDate(source.submittedAt)} | Grouping: ${source.assignmentMethod} | Photos: ${source.photoCount}`);
    add(lines, `Location: ${source.location?.address || (source.location ? `${source.location.latitude}, ${source.location.longitude}` : 'No saved GPS')}`);
    add(lines, `Citizen observation: ${source.description || 'No description supplied.'}`);
    add(lines, `AI category suggestion: ${source.classification?.suggestedCategory || 'Unavailable'} (${source.classification?.status || 'NO_RECORD'})`);
    if (source.classification?.evidence) add(lines, `Classification evidence: ${source.classification.evidence}`);
    add(lines, `AI severity suggestion: ${source.severity?.suggestedLevel || 'Unavailable'} (${source.severity?.status || 'NO_RECORD'})`);
    if (source.severity?.uncertainty) add(lines, `Severity uncertainty: ${source.severity.uncertainty}`);
  }

  add(lines, report.liveDraft
    ? 'This PDF is generated from live cluster membership. It is not an immutable report version or a record of formal approval.'
    : report.version?.approval
      ? 'This PDF reproduces the immutable evidence snapshot bound to the formal approval shown above.'
      : 'This PDF reproduces an immutable evidence snapshot. It is not a record of formal approval.',
  { size: 9, bold: true, gap: 8 });
  return buildPdf(lines, report.cluster.publicId, report.version?.number);
}

function buildPdf(lines: PdfLine[], reference: string, version?: number): Buffer {
  const pages: PdfLine[][] = [];
  let page: PdfLine[] = [];
  let used = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const height = (line.size ?? 10) + (line.gap ?? 2) + 3;
    const next = lines[index + 1];
    const nextHeight = line.keepWithNext && next ? (next.size ?? 10) + (next.gap ?? 2) + 3 : 0;
    if (page.length && used + height + nextHeight > 680) { pages.push(page); page = []; used = 0; }
    page.push(line); used += height;
  }
  if (page.length || !pages.length) pages.push(page);

  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((pageLines, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    let y = 775;
    const commands: string[] = [];
    commands.push(`BT /F2 8 Tf 50 810 Td (${escapePdf(`CivicAI / ${reference}${version ? ` / Version ${version}` : ' / Live draft'}`)}) Tj ET`);
    commands.push('0.75 w 50 802 m 545 802 l S');
    for (const line of pageLines) {
      y -= line.gap ?? 2;
      const size = line.size ?? 10;
      commands.push(`BT /F${line.bold ? 2 : 1} ${size} Tf 50 ${y} Td (${escapePdf(line.text)}) Tj ET`);
      y -= size + 3;
    }
    commands.push('0.5 w 50 40 m 545 40 l S');
    commands.push(`BT /F1 8 Tf 50 25 Td (${escapePdf(reference)} - Page ${index + 1} of ${pages.length}) Tj ET`);
    const stream = commands.join('\n');
    objects[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId - 1] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let output = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(output, 'latin1');
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}
