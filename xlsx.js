/* Poliklinik Defteri — bağımlılıksız, küçük bir Excel (.xlsx) yazıcı.
   Uygulama internetsiz de çalışabilsin diye dış kütüphane kullanılmaz. */
(function (root) {
  'use strict';

  const enc = new TextEncoder();

  /* ---------- ZIP (sıkıştırmasız) ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files, when) {
    const d = when || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const parts = chunks.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let p = 0;
    for (const part of parts) { out.set(part, p); p += part.length; }
    return out;
  }

  /* ---------- yardımcılar ---------- */
  const x = (s) => String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  /* Excel tarih seri numarası (yerel saat) */
  function serialFromTs(ts) { const off = new Date(ts).getTimezoneOffset(); return (ts - off * 60000) / 86400000 + 25569; }
  function serialFromISODate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569 : null; }

  /* Stil kimlikleri (styles.xml içindeki cellXfs sırası) */
  const ST = { normal: 0, header: 1, datetime: 2, date: 3, wrap: 4, title: 5, sub: 6, text: 7, alert: 8, number: 9 };
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy\\ hh:mm"/><numFmt numFmtId="165" formatCode="dd\\.mm\\.yyyy"/></numFmts>' +
    '<fonts count="5">' +
      '<font><sz val="11"/><color rgb="FF16335D"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="15"/><color rgb="FF16335D"/><name val="Cambria"/><family val="1"/></font>' +
      '<font><sz val="10"/><color rgb="FF5B6B7E"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFA8322A"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF16335D"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD6DDE4"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* sheet = { name, letterhead: [satır1, satır2, satır3], caption, columns: [{header, width, type}], rows: [[...]] }
     type: 'text' | 'wrap' | 'datetime' (ms) | 'date' ('YYYY-MM-DD') | 'number' | 'alert' */
  function sheetXML(sheet, hasLogo) {
    const HEAD = 6; // başlık satırı (1-3 antet, 4 açıklama, 5 boş)
    const nCols = sheet.columns.length;
    const last = colName(nCols - 1);
    const lastRow = HEAD + Math.max(sheet.rows.length, 1);
    const cell = (r, c, v, s) => {
      const ref = colName(c) + r;
      if (v === null || v === undefined || v === '') return '<c r="' + ref + '" s="' + s + '"/>';
      if (typeof v === 'number') return '<c r="' + ref + '" s="' + s + '"><v>' + v + '</v></c>';
      return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + x(v) + '</t></is></c>';
    };
    let rows = '';
    const lh = sheet.letterhead || [];
    const tcol = hasLogo ? 1 : 0;
    rows += '<row r="1" ht="24" customHeight="1">' + cell(1, tcol, lh[0], ST.title) + '</row>';
    rows += '<row r="2" ht="16" customHeight="1">' + cell(2, tcol, lh[1], ST.sub) + '</row>';
    rows += '<row r="3" ht="16" customHeight="1">' + cell(3, tcol, lh[2], ST.sub) + '</row>';
    rows += '<row r="4" ht="20" customHeight="1">' + cell(4, 0, sheet.caption, ST.sub) + '</row>';
    rows += '<row r="' + HEAD + '" ht="30" customHeight="1">' + sheet.columns.map((c, i) => cell(HEAD, i, c.header, ST.header)).join('') + '</row>';
    sheet.rows.forEach((r, ri) => {
      const rn = HEAD + 1 + ri;
      rows += '<row r="' + rn + '">' + sheet.columns.map((col, ci) => {
        let v = r[ci];
        switch (col.type) {
          case 'datetime': return cell(rn, ci, typeof v === 'number' && isFinite(v) ? serialFromTs(v) : '', ST.datetime);
          case 'date': return cell(rn, ci, serialFromISODate(v), ST.date);
          case 'number': return cell(rn, ci, typeof v === 'number' ? v : '', ST.number);
          case 'wrap': return cell(rn, ci, v, ST.wrap);
          case 'alert': return cell(rn, ci, v, ST.alert);
          default: return cell(rn, ci, v == null ? '' : String(v), ST.text);
        }
      }).join('') + '</row>';
    });
    const cols = '<cols>' + sheet.columns.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 14) + '" customWidth="1"/>').join('') + '</cols>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      '<dimension ref="A1:' + last + lastRow + '"/>' +
      '<sheetViews><sheetView workbookViewId="0" zoomScale="100"><pane ySplit="' + HEAD + '" topLeftCell="A' + (HEAD + 1) + '" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A' + (HEAD + 1) + '" sqref="A' + (HEAD + 1) + '"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' + cols +
      '<sheetData>' + rows + '</sheetData>' +
      '<autoFilter ref="A' + HEAD + ':' + last + lastRow + '"/>' +
      '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      '<headerFooter><oddFooter>&amp;L&amp;8Op. Dr. Gail Gasimov — drgailgasimov.com&amp;R&amp;8Sayfa &amp;P / &amp;N</oddFooter></headerFooter>' +
      (hasLogo ? '<drawing r:id="rId1"/>' : '') +
      '</worksheet>';
  }

  function drawingXML(px) {
    const emu = (n) => Math.round(n * 9525);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>' + emu(6) + '</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>' + emu(3) + '</xdr:rowOff></xdr:from>' +
      '<xdr:ext cx="' + emu(px.w) + '" cy="' + emu(px.h) + '"/>' +
      '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo" descr="Gail Gasimov logosu"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
      '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
      '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + emu(px.w) + '" cy="' + emu(px.h) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>' +
      '<xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>';
  }

  /* opts.logo: { png: Uint8Array, w, h } — görüntülenecek piksel boyutu */
  function build(sheets, opts) {
    opts = opts || {};
    const logo = opts.logo && opts.logo.png && opts.logo.png.length ? opts.logo : null;
    const files = [];
    const ctOverrides = sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
      (logo ? sheets.map((s, i) => '<Override PartName="/xl/drawings/drawing' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>').join('') : '');
    files.push({ name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      (logo ? '<Default Extension="png" ContentType="image/png"/>' : '') +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      ctOverrides + '</Types>' });
    files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>' });
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    files.push({ name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + x(opts.title || 'Poliklinik Defteri') + '</dc:title><dc:creator>' + x(opts.author || '') + '</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>' });
    const defNames = sheets.map((s, i) => {
      const last = colName(s.columns.length - 1);
      return '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + x(s.name) + '\'!$A$6:$' + last + '$' + (6 + Math.max(s.rows.length, 1)) + '</definedName>';
    }).join('');
    files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      sheets.map((s, i) => '<sheet name="' + x(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
      '</sheets><definedNames>' + defNames + '</definedNames></workbook>' });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>' });
    files.push({ name: 'xl/styles.xml', data: STYLES });
    sheets.forEach((s, i) => {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXML(s, !!logo) });
      if (logo) {
        files.push({ name: 'xl/worksheets/_rels/sheet' + (i + 1) + '.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + (i + 1) + '.xml"/></Relationships>' });
        files.push({ name: 'xl/drawings/drawing' + (i + 1) + '.xml', data: drawingXML(logo) });
        files.push({ name: 'xl/drawings/_rels/drawing' + (i + 1) + '.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>' });
      }
    });
    if (logo) files.push({ name: 'xl/media/logo.png', data: logo.png });
    return zip(files);
  }

  const XLSXW = { build, colName, serialFromTs, serialFromISODate, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = XLSXW;
  else root.XLSXW = XLSXW;
})(typeof self !== 'undefined' ? self : globalThis);
