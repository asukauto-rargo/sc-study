import { readFile } from 'node:fs/promises';

/**
 * PDF をページ単位のテキストに分解する。
 * pdfjs-dist の legacy ビルドを使うので Node でそのまま動く（poppler 不要）。
 */
export async function extractPages(path) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    // y 座標が変わったら改行として扱い、スライドの行構造を保つ
    let text = '';
    let lastY = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 3) text += '\n';
      text += item.str;
      if (y !== undefined) lastY = y;
    }
    pages.push(normalize(text));
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

/** 全角スペースや連続改行をそろえる */
export function normalize(s) {
  return s
    .replace(/ /g, ' ')
    .replace(/[ \t　]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** ページ番号・ヘッダフッタらしい行を落とす */
export function stripChrome(text) {
  return text
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (/^[-－—‐]\s*\d+\s*[-－—‐]$/.test(t)) return false; // －12－
      if (/^\d{1,3}$/.test(t)) return false;
      if (/^(午前|午後)\s*[ⅠⅡ12]/.test(t) && t.length < 24) return false;
      if (/^(問題|解答)例?$/.test(t)) return false;
      return true;
    })
    .join('\n');
}
