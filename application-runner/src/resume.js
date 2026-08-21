import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function buildResumePdf(text) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  const fontSize = 10;
  const lineHeight = 14;
  const width = 612;
  const height = 792;
  const maxChars = 92;
  let page = document.addPage([width, height]);
  let y = height - margin;
  const paragraphs = String(text).replace(/\r/g, '').split('\n');
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
    for (const value of lines) {
      if (y < margin) {
        page = document.addPage([width, height]);
        y = height - margin;
      }
      page.drawText(value, { x: margin, y, size: fontSize, font: value === value.toUpperCase() && value.length < 80 ? bold : font, color: rgb(0.08, 0.08, 0.08) });
      y -= lineHeight;
    }
    y -= 4;
  }
  return Buffer.from(await document.save());
}

