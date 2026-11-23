import { exportBody, exportHeading } from './export-content.mjs';
import { officeMath, xml } from './export-word-math.mjs';
import { wordArchive } from './export-word-zip.mjs';

const office = 'http://schemas.openxmlformats.org/officeDocument/2006';
const packageNamespace = 'http://schemas.openxmlformats.org/package/2006';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006';
const relationships = `${office}/relationships`;
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const textWidth = 9960;

function textRun(text, { bold, italic, underline, vertical } = {}) {
  if (!text) return '';
  const properties = (bold ? '<w:b/>' : '') + (italic ? '<w:i/>' : '')
    + (underline ? '<w:u w:val="single"/>' : '')
    + (vertical ? `<w:vertAlign w:val="${vertical}"/>` : '');
  return '<w:r>' + (properties ? `<w:rPr>${properties}</w:rPr>` : '')
    + `<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

function paragraph(contents, { indent, style, keepNext, align } = {}) {
  const properties = (style ? `<w:pStyle w:val="${style}"/>` : '')
    + (keepNext ? '<w:keepNext/>' : '')
    + (indent ? `<w:ind w:left="${indent}"/>` : '')
    + (align ? `<w:jc w:val="${align}"/>` : '');
  return '<w:p>' + (properties ? `<w:pPr>${properties}</w:pPr>` : '') + contents + '</w:p>';
}

function imageSource(node) {
  return new URL(node.getAttribute('src'), document.baseURI).href;
}

async function prepareImage(url, filename, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法读取题图：${label}。`);
  const blob = await response.blob();
  const objectURL = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectURL;
    await image.decode();
    const scale = Math.min(1, 605 / image.naturalWidth, 397 / image.naturalHeight);
    const width = Math.round(image.naturalWidth * scale * 9525);
    const height = Math.round(image.naturalHeight * scale * 9525);
    if (blob.type === 'image/png' || blob.type === 'image/jpeg') {
      const extension = blob.type === 'image/png' ? 'png' : 'jpg';
      return { filename: `${filename}.${extension}`, width, height, bytes: new Uint8Array(await blob.arrayBuffer()) };
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('PNG conversion failed');
    return { filename: `${filename}.png`, width, height, bytes: new Uint8Array(await png.arrayBuffer()) };
  } catch {
    throw new Error(`无法嵌入题图：${label}。`);
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

async function prepareImages(bodies) {
  const images = new Map();
  for (const body of bodies) {
    for (const image of body.querySelectorAll('img[src]')) {
      const url = imageSource(image);
      if (!images.has(url)) images.set(url, { url, label: image.alt || '试题配图' });
    }
  }
  const queue = [...images.values()];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (next < queue.length) {
      const index = next++;
      const item = queue[index];
      item.relationship = `rIdImage${index + 1}`;
      Object.assign(item, await prepareImage(item.url, `question-image-${index + 1}`, item.label));
    }
  }));
  return images;
}

function imageRun(node, context) {
  const { width, height, relationship } = context.images.get(imageSource(node));
  const id = ++context.drawingId;
  const label = xml(node.alt || '试题配图');
  return `<w:r><w:drawing><wp:inline>
  <wp:extent cx="${width}" cy="${height}"/>
  <wp:docPr id="${id}" name="Picture ${id}" descr="${label}"/>
  <a:graphic><a:graphicData uri="${drawing}/picture"><pic:pic>
    <pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>
    <pic:blipFill><a:blip r:embed="${relationship}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
    <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    </pic:spPr>
  </pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function tableBlock(table, context, indent) {
  const rows = [...table.rows];
  if (!rows.length) return '';
  const columns = Math.max(1, ...rows.map((row) => [...row.cells].reduce((total, cell) => total + cell.colSpan, 0)));
  const width = Math.floor((textWidth - (indent || 0)) / columns);
  const grid = `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(columns)}</w:tblGrid>`;
  const borders = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:color="687782"/>`).join('') + '</w:tblBorders>';
  const indentation = indent ? `<w:tblInd w:type="dxa" w:w="${indent}"/>` : '';
  const tableRows = rows.map((row) => {
    let used = 0;
    const cells = [...row.cells].map((cell) => {
      used += cell.colSpan;
      const span = cell.colSpan > 1 ? `<w:gridSpan w:val="${cell.colSpan}"/>` : '';
      const cellProperties = `<w:tcPr><w:tcW w:type="dxa" w:w="${width * cell.colSpan}"/>${span}</w:tcPr>`;
      const content = blocks(cell, context, { align: 'center', style: 'TableText' });
      return `<w:tc>${cellProperties}${content || '<w:p/>'}</w:tc>`;
    });
    for (; used < columns; used++) cells.push('<w:tc><w:p/></w:tc>');
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join('')}</w:tr>`;
  });
  return `<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="${width * columns}"/>${indentation}${borders}
    <w:tblLayout w:type="fixed"/></w:tblPr>${grid}${tableRows.join('')}</w:tbl>`;
}

function blocks(root, context, options = {}) {
  const output = [];
  let runs = '';
  let prefix = options.prefix ?? '';
  function write(contents, properties = {}) {
    if (!contents) return;
    output.push(paragraph(prefix + contents, { ...options, ...properties }));
    prefix = '';
  }
  function flush() {
    write(runs);
    runs = '';
  }
  function visit(node, style = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.data.replace(/[ \n\r\t]+/g, ' ');
      if (runs || value.trim()) runs += textRun(value, style);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches('.math-tex[data-tex]')) {
      const math = officeMath(node, context.macros);
      if (node.dataset.display === '1') {
        flush();
        write(math, { align: 'center' });
      } else {
        runs += math;
      }
      return;
    }
    const children = (format = style) => {
      for (const child of node.childNodes) visit(child, format);
    };
    switch (node.localName) {
      case 'br':
        flush();
        break;
      case 'ol': case 'ul': {
        flush();
        const choices = node.classList.contains('choices');
        let number = node.start || 1;
        for (const item of node.children) {
          if (item.localName !== 'li') continue;
          const marker = choices ? '' : (node.localName === 'ol' ? `（${item.getAttribute('value') ?? number}）` : '• ');
          output.push(blocks(item, context, { indent: (options.indent ?? 0) + (choices ? 240 : 320), prefix: textRun(marker) }));
          number = Number(item.getAttribute('value') ?? number) + 1;
        }
        break;
      }
      case 'figure': {
        flush();
        const image = node.querySelector('img[src]');
        const caption = node.querySelector('figcaption')?.textContent.trim();
        if (image) {
          write(imageRun(image, context), { keepNext: Boolean(caption) });
          write(textRun(caption), { style: 'Caption' });
        } else {
          children();
          flush();
        }
        break;
      }
      case 'img':
        flush();
        if (node.hasAttribute('src')) write(imageRun(node, context));
        break;
      case 'table':
        flush();
        output.push(tableBlock(node, context, options.indent));
        break;
      case 'b': case 'strong':
        children({ ...style, bold: true });
        break;
      case 'i': case 'em':
        children({ ...style, italic: true });
        break;
      case 'u':
        children({ ...style, underline: true });
        break;
      case 'sup': case 'sub':
        children({ ...style, vertical: node.localName === 'sup' ? 'superscript' : 'subscript' });
        break;
      case 'p': case 'div': case 'blockquote':
        flush();
        children();
        flush();
        break;
      default:
        children();
    }
  }
  for (const node of root.childNodes) visit(node);
  flush();
  return output.join('');
}

function relationship(id, type, target) {
  return `<Relationship Id="${id}" Type="${relationships}/${type}" Target="${target}"/>`;
}

function relationshipDocument(contents) {
  return `${xmlHeader}<Relationships xmlns="${packageNamespace}/relationships">${contents}</Relationships>`;
}

const contentTypes = `${xmlHeader}<Types xmlns="${packageNamespace}/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const styles = `${xmlHeader}<w:styles xmlns:w="${wordNamespace}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="宋体"/>
      <w:color w:val="151515"/><w:sz w:val="22"/><w:szCs w:val="22"/>
      <w:lang w:val="zh-CN" w:eastAsia="zh-CN"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="100" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:after="200"/><w:jc w:val="center"/></w:pPr>
    <w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Question"><w:name w:val="Question"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="180" w:after="60"/></w:pPr>
    <w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:color w:val="454545"/><w:sz w:val="18"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table text"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;

function documentXML(contents) {
  return `${xmlHeader}<w:document xmlns:w="${wordNamespace}" xmlns:r="${relationships}"
    xmlns:m="${office}/math" xmlns:wp="${drawing}/wordprocessingDrawing"
    xmlns:a="${drawing}/main" xmlns:pic="${drawing}/picture">
    <w:body>${contents}<w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="907" w:right="964" w:bottom="907" w:left="964" w:header="450" w:footer="450" w:gutter="0"/>
    </w:sectPr></w:body></w:document>`;
}

export async function createWordDocument(questions, { macros, title }) {
  const bodies = questions.map(exportBody);
  const images = await prepareImages(bodies);
  const context = { images, macros, drawingId: 0 };
  const content = [paragraph(textRun(title), { style: 'Title' })];
  questions.forEach((question, index) => {
    content.push(paragraph(textRun(exportHeading(question, index)), { style: 'Question' }));
    content.push(blocks(bodies[index], context));
  });
  const documentRelationships = relationship('rIdStyles', 'styles', 'styles.xml')
    + [...images.values()].map((image) => relationship(image.relationship, 'image', `media/${image.filename}`)).join('');
  return wordArchive([
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', relationshipDocument(relationship('rIdDocument', 'officeDocument', 'word/document.xml'))],
    ['word/document.xml', documentXML(content.join(''))],
    ['word/_rels/document.xml.rels', relationshipDocument(documentRelationships)],
    ['word/styles.xml', styles],
    ...[...images.values()].map((image) => [`word/media/${image.filename}`, image.bytes]),
  ]);
}
