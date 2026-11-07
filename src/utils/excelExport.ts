/**
 * Pure TypeScript Microsoft Excel (.xlsx) OpenXML workbook generator.
 * Produces a valid ZIP-packaged Office Open XML workbook without external dependencies.
 */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

const computeCrc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const writeUint16LE = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, value & 0xffff, true);
};

const writeUint32LE = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value >>> 0, true);
};

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const createStoredZipArchive = (entries: ZipEntry[]): Uint8Array => {
  const encoder = new TextEncoder();
  const prepared = entries.map((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const crc = computeCrc32(entry.data);
    return {
      nameBytes,
      data: entry.data,
      crc,
    };
  });

  let localTotalSize = 0;
  let centralTotalSize = 0;
  for (const item of prepared) {
    localTotalSize += 30 + item.nameBytes.length + item.data.length;
    centralTotalSize += 46 + item.nameBytes.length;
  }

  const totalSize = localTotalSize + centralTotalSize + 22;
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);

  let localOffset = 0;
  const localOffsets: number[] = [];

  for (const item of prepared) {
    localOffsets.push(localOffset);
    writeUint32LE(view, localOffset, 0x04034b50); // Local file header signature
    writeUint16LE(view, localOffset + 4, 20); // Version needed to extract (2.0)
    writeUint16LE(view, localOffset + 6, 0); // General purpose bit flag
    writeUint16LE(view, localOffset + 8, 0); // Compression method (0 = store)
    writeUint16LE(view, localOffset + 10, 0); // Last mod file time
    writeUint16LE(view, localOffset + 12, 0x21); // Last mod file date
    writeUint32LE(view, localOffset + 14, item.crc);
    writeUint32LE(view, localOffset + 18, item.data.length);
    writeUint32LE(view, localOffset + 22, item.data.length);
    writeUint16LE(view, localOffset + 26, item.nameBytes.length);
    writeUint16LE(view, localOffset + 28, 0); // Extra field length
    output.set(item.nameBytes, localOffset + 30);
    output.set(item.data, localOffset + 30 + item.nameBytes.length);
    localOffset += 30 + item.nameBytes.length + item.data.length;
  }

  let centralOffset = localOffset;
  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index];
    writeUint32LE(view, centralOffset, 0x02014b50); // Central directory signature
    writeUint16LE(view, centralOffset + 4, 20); // Version made by
    writeUint16LE(view, centralOffset + 6, 20); // Version needed
    writeUint16LE(view, centralOffset + 8, 0); // Flags
    writeUint16LE(view, centralOffset + 10, 0); // Compression method (0 = store)
    writeUint16LE(view, centralOffset + 12, 0); // Time
    writeUint16LE(view, centralOffset + 14, 0x21); // Date
    writeUint32LE(view, centralOffset + 16, item.crc);
    writeUint32LE(view, centralOffset + 20, item.data.length);
    writeUint32LE(view, centralOffset + 24, item.data.length);
    writeUint16LE(view, centralOffset + 28, item.nameBytes.length);
    writeUint16LE(view, centralOffset + 30, 0); // Extra field length
    writeUint16LE(view, centralOffset + 32, 0); // File comment length
    writeUint16LE(view, centralOffset + 34, 0); // Disk number start
    writeUint16LE(view, centralOffset + 36, 0); // Internal file attributes
    writeUint32LE(view, centralOffset + 38, 0); // External file attributes
    writeUint32LE(view, centralOffset + 42, localOffsets[index]); // Relative offset of local header
    output.set(item.nameBytes, centralOffset + 46);
    centralOffset += 46 + item.nameBytes.length;
  }

  // End of central directory record
  writeUint32LE(view, centralOffset, 0x06054b50);
  writeUint16LE(view, centralOffset + 4, 0); // Number of this disk
  writeUint16LE(view, centralOffset + 6, 0); // Disk where central directory starts
  writeUint16LE(view, centralOffset + 8, prepared.length);
  writeUint16LE(view, centralOffset + 10, prepared.length);
  writeUint32LE(view, centralOffset + 12, centralTotalSize);
  writeUint32LE(view, centralOffset + 16, localTotalSize);
  writeUint16LE(view, centralOffset + 20, 0); // Comment length

  return output;
};

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const getExcelColumnLetter = (colIndexZeroBased: number): string => {
  let index = colIndexZeroBased + 1;
  let column = '';
  while (index > 0) {
    const remainder = (index - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    index = Math.floor((index - 1) / 26);
  }
  return column;
};

const isStringIdentifierColumn = (header: string): boolean =>
  /\b(barcode|dis|code|sku|id|invoice|customer|description|item|product|period|date)\b/i.test(
    header
  );

const parseExcelNumericValue = (rawValue: string, header: string): number | undefined => {
  const trimmed = rawValue.trim();
  if (!trimmed) return undefined;
  if (isStringIdentifierColumn(header)) return undefined;
  // Preserve strings with leading zeros (e.g. "00080432400395" or "02")
  if (/^0\d+$/.test(trimmed)) return undefined;

  const cleaned = trimmed
    .replace(/^R\s*/i, '')
    .replace(/(\d)\s+(?=\d{3}(?:\b|\.))/g, '$1')
    .replace(/,/g, '');

  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const buildExcelWorkbookBytes = (
  headers: string[],
  rows: Record<string, string>[],
  sheetTitle = 'AnalytiCore Data'
): Uint8Array => {
  const encoder = new TextEncoder();
  const safeSheetName =
    escapeXml(
      sheetTitle
        .replace(/[\\/?*[\]:]/g, ' ')
        .trim()
        .slice(0, 31)
    ) || 'Sheet1';

  const colWidths = headers.map((header) => {
    const maxCellLen = rows.reduce((maxLen, row) => {
      const val = String(row[header] ?? '');
      return Math.max(maxLen, val.length);
    }, header.length);
    return Math.min(Math.max(maxCellLen + 4, 10), 48);
  });

  const colsXml =
    headers.length > 0
      ? `<cols>${colWidths
          .map(
            (width, idx) =>
              `<col min="${idx + 1}" max="${idx + 1}" width="${width}" customWidth="1"/>`
          )
          .join('')}</cols>`
      : '';

  const headerCellsXml = headers
    .map((header, colIdx) => {
      const ref = `${getExcelColumnLetter(colIdx)}1`;
      return `<c r="${ref}" s="1" t="inlineStr"><is><t>${escapeXml(header)}</t></is></c>`;
    })
    .join('');

  const dataRowsXml = rows
    .map((row, rowIdx) => {
      const excelRowNumber = rowIdx + 2;
      const cellsXml = headers
        .map((header, colIdx) => {
          const ref = `${getExcelColumnLetter(colIdx)}${excelRowNumber}`;
          const rawValue = String(row[header] ?? '');
          if (!rawValue.trim()) {
            return `<c r="${ref}" t="inlineStr"><is><t></t></is></c>`;
          }
          const numericVal = parseExcelNumericValue(rawValue, header);
          if (numericVal !== undefined) {
            return `<c r="${ref}"><v>${numericVal}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(rawValue)}</t></is></c>`;
        })
        .join('');
      return `<row r="${excelRowNumber}">${cellsXml}</row>`;
    })
    .join('');

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${colsXml}
  <sheetData>
    <row r="1">${headerCellsXml}</row>
    ${dataRowsXml}
  </sheetData>
</worksheet>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
</styleSheet>`;

  return createStoredZipArchive([
    { name: '[Content_Types].xml', data: encoder.encode(contentTypesXml) },
    { name: '_rels/.rels', data: encoder.encode(rootRelsXml) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRelsXml) },
    { name: 'xl/styles.xml', data: encoder.encode(stylesXml) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml) },
  ]);
};
