/**
 * PPTX to HTML converter using JSZip (no external dependencies).
 * Parses .pptx XML to generate a simple HTML preview with text and images.
 */

import JSZip from 'jszip';

const EMU_PER_INCH = 914400;
const DPI = 96;

function emuToPx(emu: number): number {
  return Math.round((emu / EMU_PER_INCH) * DPI);
}

/** Parse XML string to DOM-like object using browser DOMParser. */
function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

/** Build a map from Relationship Id -> Target path. */
function parseRels(relsXml: string): Map<string, string> {
  const doc = parseXml(relsXml);
  const map = new Map<string, string>();
  const relationships = doc.getElementsByTagName('Relationship');
  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships[i];
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) map.set(id, target);
  }
  return map;
}

/** Extract all text content from a paragraph element. */
function extractParagraphText(pElem: Element): string {
  const runs = pElem.getElementsByTagName('a:r');
  let text = '';
  for (let i = 0; i < runs.length; i++) {
    const t = runs[i].getElementsByTagName('a:t')[0];
    if (t) text += t.textContent || '';
  }
  return text;
}

/** Extract text styling from a run properties element. */
function extractRunStyle(rPr: Element | null): string {
  const styles: string[] = [];
  if (!rPr) return '';

  const sz = rPr.getAttribute('sz');
  if (sz) styles.push(`font-size:${Math.round(parseInt(sz, 10) / 100)}px`);

  const b = rPr.getAttribute('b');
  if (b === '1') styles.push('font-weight:bold');

  const i = rPr.getAttribute('i');
  if (i === '1') styles.push('font-style:italic');

  const solidFill = rPr.getElementsByTagName('a:solidFill')[0];
  if (solidFill) {
    const srgbClr = solidFill.getElementsByTagName('a:srgbClr')[0];
    const sysClr = solidFill.getElementsByTagName('a:sysClr')[0];
    if (srgbClr) {
      const val = srgbClr.getAttribute('val');
      if (val) styles.push(`color:#${val}`);
    } else if (sysClr) {
      const lastClr = sysClr.getAttribute('lastClr');
      if (lastClr) styles.push(`color:#${lastClr}`);
    }
  }

  const latin = rPr.getElementsByTagName('a:latin')[0];
  if (latin) {
    const typeface = latin.getAttribute('typeface');
    if (typeface && typeface !== '+mn-lt' && typeface !== '+mj-lt') {
      styles.push(`font-family:"${typeface}",sans-serif`);
    }
  }

  return styles.join(';');
}

/** Parse transform (position + size) from a shape. */
function parseTransform(spPr: Element | null): { x: number; y: number; w: number; h: number } | null {
  if (!spPr) return null;
  const xfrm = spPr.getElementsByTagName('a:xfrm')[0];
  if (!xfrm) return null;

  const off = xfrm.getElementsByTagName('a:off')[0];
  const ext = xfrm.getElementsByTagName('a:ext')[0];
  if (!off || !ext) return null;

  const x = parseInt(off.getAttribute('x') || '0', 10);
  const y = parseInt(off.getAttribute('y') || '0', 10);
  const cx = parseInt(ext.getAttribute('cx') || '0', 10);
  const cy = parseInt(ext.getAttribute('cy') || '0', 10);

  return {
    x: emuToPx(x),
    y: emuToPx(y),
    w: emuToPx(cx),
    h: emuToPx(cy),
  };
}

interface SlideItem {
  type: 'text' | 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  style?: string;
  src?: string;
}

interface SlideData {
  index: number;
  items: SlideItem[];
  w: number;
  h: number;
}

async function parseSlide(
  zip: JSZip,
  slidePath: string,
  slideRelsPath: string,
  index: number,
  slideW: number,
  slideH: number,
): Promise<SlideData> {
  const items: SlideItem[] = [];

  // Parse slide relationships (image ID -> file path)
  let imageRels = new Map<string, string>();
  const relsFile = zip.files[slideRelsPath];
  if (relsFile) {
    const relsXml = await relsFile.async('text');
    imageRels = parseRels(relsXml);
  }

  // Parse slide content
  const slideFile = zip.files[slidePath];
  if (!slideFile) return { index, items, w: slideW, h: slideH };

  const slideXml = await slideFile.async('text');
  const doc = parseXml(slideXml);

  // Extract shapes (text + images)
  const spTree = doc.getElementsByTagName('p:spTree')[0];
  if (!spTree) return { index, items, w: slideW, h: slideH };

  // Text shapes
  const shapes = spTree.getElementsByTagName('p:sp');
  for (let i = 0; i < shapes.length; i++) {
    const sp = shapes[i];
    const spPr = sp.getElementsByTagName('p:spPr')[0];
    const txBody = sp.getElementsByTagName('p:txBody')[0];

    const tfrm = parseTransform(spPr);
    if (!tfrm) continue;

    if (txBody) {
      const paragraphs = txBody.getElementsByTagName('a:p');
      let fullText = '';
      let fullStyle = '';
      for (let j = 0; j < paragraphs.length; j++) {
        const p = paragraphs[j];
        const text = extractParagraphText(p);
        if (text) {
          const r = p.getElementsByTagName('a:r')[0];
          const rPr = r ? r.getElementsByTagName('a:rPr')[0] : null;
          const style = extractRunStyle(rPr || null);
          if (fullText) fullText += '\n';
          fullText += text;
          if (style) fullStyle = style;
        }
      }
      if (fullText) {
        items.push({ type: 'text', ...tfrm, text: fullText, style: fullStyle });
      }
    }
  }

  // Images
  const pics = spTree.getElementsByTagName('p:pic');
  for (let i = 0; i < pics.length; i++) {
    const pic = pics[i];
    const spPr = pic.getElementsByTagName('p:spPr')[0];
    const blipFill = pic.getElementsByTagName('p:blipFill')[0];

    const tfrm = parseTransform(spPr);
    if (!tfrm || !blipFill) continue;

    const blip = blipFill.getElementsByTagName('a:blip')[0];
    if (!blip) continue;

    const embedId = blip.getAttribute('r:embed');
    if (!embedId) continue;

    const imageTarget = imageRels.get(embedId);
    if (!imageTarget) continue;

    // Resolve image path ( Target may be relative like "../media/image1.png" )
    const imagePath = slidePath.replace(/[^/]+$/, '') + imageTarget.replace(/^\.\//, '');
    const imageFile = zip.files[imagePath] || zip.files[imageTarget];
    if (imageFile) {
      const base64 = await imageFile.async('base64');
      // Guess mime type from extension
      const ext = imageTarget.split('.').pop()?.toLowerCase() || 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png';
      items.push({ type: 'image', ...tfrm, src: `data:${mime};base64,${base64}` });
    }
  }

  return { index, items, w: slideW, h: slideH };
}

/** Get slide dimensions from presentation.xml. */
function getSlideSize(doc: Document): { w: number; h: number } {
  const sldSz = doc.getElementsByTagName('p:sldSz')[0];
  if (sldSz) {
    const cx = parseInt(sldSz.getAttribute('cx') || '12192000', 10);
    const cy = parseInt(sldSz.getAttribute('cy') || '6858000', 10);
    return { w: emuToPx(cx), h: emuToPx(cy) };
  }
  // Default 16:9
  return { w: 1280, h: 720 };
}

export async function pptxToHtml(buffer: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  // Parse presentation.xml to get slide order
  const presFile = zip.files['ppt/presentation.xml'];
  if (!presFile) throw new Error('Invalid PPTX: missing presentation.xml');

  const presXml = await presFile.async('text');
  const presDoc = parseXml(presXml);

  // Slide dimensions
  const { w: slideW, h: slideH } = getSlideSize(presDoc);

  // Parse presentation relationships
  const presRelsFile = zip.files['ppt/_rels/presentation.xml.rels'];
  let slideRels = new Map<string, string>();
  if (presRelsFile) {
    const relsXml = await presRelsFile.async('text');
    slideRels = parseRels(relsXml);
  }

  // Build slide list from sldIdLst
  const sldIdLst = presDoc.getElementsByTagName('p:sldIdLst')[0];
  const slideIds: string[] = [];
  if (sldIdLst) {
    const sldIds = sldIdLst.getElementsByTagName('p:sldId');
    for (let i = 0; i < sldIds.length; i++) {
      const rid = sldIds[i].getAttribute('r:id');
      if (rid) slideIds.push(rid);
    }
  }

  // Parse each slide
  const slides: SlideData[] = [];
  for (let i = 0; i < slideIds.length; i++) {
    const rid = slideIds[i];
    const slidePath = slideRels.get(rid);
    if (!slidePath) continue;

    const fullSlidePath = `ppt/${slidePath}`;
    const slideFileName = slidePath.split('/').pop() || '';
    const slideRelsPath = `ppt/slides/_rels/${slideFileName}.rels`;

    const slide = await parseSlide(zip, fullSlidePath, slideRelsPath, i + 1, slideW, slideH);
    slides.push(slide);
  }

  // Generate HTML
  const slidesHtml = slides
    .map((slide) => {
      const itemsHtml = slide.items
        .map((item) => {
          if (item.type === 'text') {
            const style = [
              `position:absolute`,
              `left:${item.x}px`,
              `top:${item.y}px`,
              `width:${item.w}px`,
              `min-height:${item.h}px`,
              `white-space:pre-wrap`,
              `word-break:break-word`,
              item.style || '',
            ].join(';');
            return `<div style="${style}">${escapeHtml(item.text || '')}</div>`;
          }
          if (item.type === 'image') {
            const style = [
              `position:absolute`,
              `left:${item.x}px`,
              `top:${item.y}px`,
              `width:${item.w}px`,
              `height:${item.h}px`,
              `object-fit:contain`,
            ].join(';');
            return `<img src="${item.src}" style="${style}" />`;
          }
          return '';
        })
        .join('\n');

      return `
        <div class="slide" style="--slide-w:${slide.w}px;--slide-h:${slide.h}px;">
          <div class="slide-inner">
            ${itemsHtml}
          </div>
        </div>
      `;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #1a1a2e;
  color: #333;
  padding: 20px;
}
.slide {
  width: 100%;
  max-width: var(--slide-w);
  margin: 0 auto 24px;
  aspect-ratio: ${slideW} / ${slideH};
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  overflow: hidden;
  position: relative;
}
.slide-inner {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
</style>
</head>
<body>
${slidesHtml}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
