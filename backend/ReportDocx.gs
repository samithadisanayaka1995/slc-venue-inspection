/**
 * ReportDocx.gs – fills the official SLC "Venue Inspection Report" Word
 * template. Pure string manipulation of the .docx XML parts, so the output
 * keeps the exact layout, fonts, logo, page border and boxes of the template.
 *
 * Input `r`:
 * {
 *   tournament, venue, dateText, curator,
 *   pitchParagraphs: [{label?: '10th December:', text: '...'}],
 *   sections: { outfield, scoreboard, dressingRooms, umpiresRoom, refereeRoom },
 *   photo: { relId: 'rIdPitchPhoto', size: {w, h} } | null
 * }
 */

var TNR_RPR = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>';

function xmlEscape_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function run_(text, bold) {
  return '<w:r><w:rPr>' + TNR_RPR + (bold ? '<w:b/>' : '') + '</w:rPr>' +
    '<w:t xml:space="preserve">' + xmlEscape_(text) + '</w:t></w:r>';
}

function contentPara_(label, text) {
  return '<w:p><w:pPr><w:spacing w:after="80"/><w:ind w:left="360"/><w:jc w:val="both"/>' +
    '<w:rPr>' + TNR_RPR + '</w:rPr></w:pPr>' +
    (label ? run_(label + ' ', true) : '') + run_(text, false) + '</w:p>';
}

function emptyPara_() {
  return '<w:p><w:pPr><w:rPr>' + TNR_RPR + '<w:b/></w:rPr></w:pPr></w:p>';
}

function paraText_(p) {
  var out = '';
  var re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, m;
  while ((m = re.exec(p))) out += m[1];
  return out;
}

// Split the body into top-level paragraphs (the template has no tables).
function splitBody_(xml) {
  var start = xml.indexOf('<w:body>') + '<w:body>'.length;
  var end = xml.indexOf('<w:sectPr');
  var body = xml.substring(start, end);
  var paras = body.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  return { head: xml.substring(0, start), paras: paras, tail: xml.substring(end) };
}

/** Reads width/height from JPEG or PNG bytes (numbers 0-255 or signed). */
function imageSize(bytes) {
  var b = function (i) { return bytes[i] & 0xff; };
  if (b(0) === 0x89 && b(1) === 0x50) { // PNG
    return { w: (b(16) << 24 | b(17) << 16 | b(18) << 8 | b(19)) >>> 0, h: (b(20) << 24 | b(21) << 16 | b(22) << 8 | b(23)) >>> 0 };
  }
  var i = 2;
  while (i < bytes.length) {
    if (b(i) !== 0xff) { i++; continue; }
    var marker = b(i + 1);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: b(i + 5) << 8 | b(i + 6), w: b(i + 7) << 8 | b(i + 8) };
    }
    i += 2 + (b(i + 2) << 8 | b(i + 3));
  }
  return null;
}

/** Centre-crop (as a:srcRect, in 1/1000 %) so the photo fills the box. */
function coverSrcRect_(size) {
  if (!size || !size.w || !size.h) return '';
  var target = 1760220 / 2438400;
  var ratio = size.w / size.h;
  if (Math.abs(ratio - target) < 0.01) return '';
  if (ratio > target) { // too wide → crop left/right
    var keepW = target / ratio;
    var lr = Math.round((1 - keepW) / 2 * 100000);
    return '<a:srcRect l="' + lr + '" r="' + lr + '"/>';
  }
  var keepH = ratio / target;
  var tb = Math.round((1 - keepH) / 2 * 100000);
  return '<a:srcRect t="' + tb + '" b="' + tb + '"/>';
}

function pitchPhotoRun_(relId, size) {
  // Same size & position as the empty box in the template (right margin,
  // 1760220 x 2438400 EMU), with a thin black border, text wraps on the left.
  var cx = 1760220, cy = 2438400;
  return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="114300" distR="0" simplePos="0" relativeHeight="251662336" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>99695</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapSquare wrapText="left"/>' +
    '<wp:docPr id="10" name="Pitch Photo"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="10" name="pitch_photo.jpeg"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + relId + '"/>' + coverSrcRect_(size) + '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:ln w="6350"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
}

function linesOf_(text) {
  return String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); })
    .filter(function (l) { return l.length > 0; });
}

/** Returns the filled word/document.xml string. */
function fillDocumentXml(xml, r) {
  var parts = splitBody_(xml);
  var paras = parts.paras;

  // 1. Header fields -------------------------------------------------------
  var header = [
    ['Tournament/Match', r.tournament],
    ['Venue', r.venue],
    ['Date', r.dateText],
    ['name', r.curator], // "Curators’s name"
  ];
  header.forEach(function (h) {
    for (var i = 0; i < paras.length; i++) {
      var t = paraText_(paras[i]);
      if (t.indexOf(h[0]) === 0 || (h[0] === 'name' && /name\s*:?\s*$/.test(t) && /Curator/.test(t))) {
        if (h[1]) {
          paras[i] = paras[i].replace(/<\/w:p>$/, run_((/\s$/.test(t) ? '' : ' ') + h[1], false) + '</w:p>');
        }
        break;
      }
    }
  });

  // 2. Photo box: the paragraph right before "Pitch:" holds the rectangle.
  var headingIdx = function (label) {
    for (var i = 0; i < paras.length; i++) {
      if (paras[i].indexOf('<w:numPr>') >= 0 && paraText_(paras[i]).indexOf(label) === 0) return i;
    }
    return -1;
  };
  var pitchIdx = headingIdx('Pitch:');
  if (pitchIdx > 0) {
    var boxPara = paras[pitchIdx - 1];
    if (r.photo && r.photo.relId) {
      // Replace the empty rectangle with the photo (same size and place).
      boxPara = boxPara.replace(/<w:r>(?:(?!<w:r>)[\s\S])*?<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent><\/w:r>/,
        pitchPhotoRun_(r.photo.relId, r.photo.size));
    } else {
      // Keep the empty box, but let text wrap beside it instead of under it.
      boxPara = boxPara.replace('<wp:wrapNone/>', '<wp:wrapSquare wrapText="left"/>')
        .replace('<w10:wrap anchorx="margin"/>', '<w10:wrap type="square" side="left" anchorx="margin"/>');
    }
    paras[pitchIdx - 1] = boxPara;
  }

  // 3. Section bodies ------------------------------------------------------
  var S = r.sections || {};
  var sections = [
    ['Pitch:', null],
    ['Outfield:', S.outfield],
    ['Scoreboard', S.scoreboard],
    ['Players', S.dressingRooms],
    ['Umpires', S.umpiresRoom],
    ['Match referee', S.refereeRoom],
  ];

  // Work from the bottom up so indexes stay valid.
  for (var k = sections.length - 1; k >= 0; k--) {
    var idx = headingIdx(sections[k][0]);
    if (idx < 0) continue;
    var j = idx + 1;
    while (j < paras.length && paras[j].indexOf('<w:numPr>') < 0 && paraText_(paras[j]).trim() === '') j++;
    var emptyCount = j - (idx + 1);

    var newParas = [];
    if (k === 0) {
      (r.pitchParagraphs || []).forEach(function (p) {
        if (p && (p.text || p.label)) newParas.push(contentPara_(p.label || '', p.text || ''));
      });
    } else {
      linesOf_(sections[k][1]).forEach(function (l) { newParas.push(contentPara_('', l)); });
    }
    if (!newParas.length) continue; // leave the template's blank lines

    // Keep the box area tall enough when the pitch text is short.
    var minLines = k === 0 ? 6 : 1;
    var spacer = [];
    for (var s = newParas.length; s < minLines; s++) spacer.push(emptyPara_());
    spacer.push(emptyPara_());

    var args = [idx + 1, emptyCount].concat(newParas, spacer);
    Array.prototype.splice.apply(paras, args);
  }

  return parts.head + paras.join('') + parts.tail;
}

/** Adds the photo relationship to word/_rels/document.xml.rels. */
function addImageRel(relsXml, relId, target) {
  if (relsXml.indexOf('Id="' + relId + '"') >= 0) return relsXml;
  return relsXml.replace('</Relationships>',
    '<Relationship Id="' + relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + target + '"/></Relationships>');
}

/** Makes sure .jpeg/.jpg/.png are declared in [Content_Types].xml. */
function ensureContentTypes(ctXml) {
  var add = '';
  if (ctXml.indexOf('Extension="jpeg"') < 0) add += '<Default Extension="jpeg" ContentType="image/jpeg"/>';
  if (ctXml.indexOf('Extension="jpg"') < 0) add += '<Default Extension="jpg" ContentType="image/jpeg"/>';
  if (ctXml.indexOf('Extension="png"') < 0) add += '<Default Extension="png" ContentType="image/png"/>';
  return add ? ctXml.replace('<Default ', add + '<Default ') : ctXml;
}

// Allow Node tests to require this file (ignored by Apps Script).
if (typeof module !== 'undefined') {
  module.exports = { imageSize: imageSize, fillDocumentXml: fillDocumentXml, addImageRel: addImageRel, ensureContentTypes: ensureContentTypes };
}
