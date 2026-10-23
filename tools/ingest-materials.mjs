#!/usr/bin/env node
/**
 * 学習資料/ 配下の PDF を Supabase に取り込む。
 *   - PDF 本体 → 非公開ストレージ（アプリ内のビューアで表示）
 *   - ページ単位のテキスト → material_pages（pgroonga で日本語全文検索）
 *
 *   node ingest-materials.mjs                # 新規・更新ぶんだけ取り込む
 *   node ingest-materials.mjs --force        # 変更がなくても作り直す
 *   node ingest-materials.mjs --draft-cards  # スライドごとに下書きカードも作る（保留状態）
 *
 * あとから 学習資料/ に PDF を足したら、もう一度実行すれば差分だけ入る。
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, extname, relative, resolve } from 'node:path';
import { connect, hasFlag, chunk, REPO_DIR } from './lib/db.mjs';
import { extractPages } from './lib/pdf.mjs';

const MATERIALS_DIR = resolve(REPO_DIR, '学習資料');
const BUCKET = 'materials';

async function listPdfs(dir) {
  const out = [];
  async function walk(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = resolve(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (extname(e.name).toLowerCase() === '.pdf' && !e.name.startsWith('.')) out.push(p);
    }
  }
  await walk(dir);
  return out.sort();
}

/** スライド1枚から下書きカードを作る（見出し＋本文の素朴な分割） */
function draftCard(pageText, title, page) {
  const lines = pageText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;
  // 1行目がデッキ名そのものなら飛ばす（講座スライドのヘッダ）
  const head = lines[0] === title ? lines[1] : lines[0];
  if (!head || head.length < 4 || head.length > 80) return null;
  const body = lines.slice(lines[0] === title ? 2 : 1).join('\n').slice(0, 900);
  if (body.length < 30) return null;
  return { front: `${head}\n\n…について説明できる？`, back: body };
}

async function main() {
  const { supabase, userId } = await connect();
  const force = hasFlag('force');
  const makeDrafts = hasFlag('draft-cards');

  const files = await listPdfs(MATERIALS_DIR);
  if (files.length === 0) {
    console.log(`PDF が見つかりません: ${MATERIALS_DIR}`);
    return;
  }
  console.log(`${files.length} 件の PDF を確認します`);

  for (const file of files) {
    const sourcePath = relative(REPO_DIR, file);
    const title = basename(file, '.pdf');
    const bytes = await readFile(file);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);

    const { data: existing } = await supabase
      .from('materials')
      .select('*')
      .eq('source_path', sourcePath)
      .maybeSingle();

    if (existing && existing.content_hash === hash && !force) {
      console.log(`= ${title}（変更なし）`);
      continue;
    }

    console.log(`→ ${title} を解析中…`);
    const pages = await extractPages(file);
    const storagePath = `${userId}/${hash}-${encodeURIComponent(title)}.pdf`;

    const up = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true });
    if (up.error) throw new Error(`アップロード失敗: ${up.error.message}`);

    const row = {
      user_id: userId,
      title,
      kind: 'pdf',
      source_path: sourcePath,
      storage_path: storagePath,
      page_count: pages.length,
      content_hash: hash,
    };

    const { data: mat, error: me } = await supabase
      .from('materials')
      .upsert(row, { onConflict: 'user_id,source_path' })
      .select('id')
      .single();
    if (me) throw new Error(`materials 保存失敗: ${me.message}`);

    // ページテキストを入れ替える
    await supabase.from('material_pages').delete().eq('material_id', mat.id);
    const rows = pages
      .map((text, i) => ({ material_id: mat.id, user_id: userId, page: i + 1, text }))
      .filter((r) => r.text.length > 0);

    for (const part of chunk(rows, 200)) {
      const { error } = await supabase.from('material_pages').insert(part);
      if (error) throw new Error(`material_pages 保存失敗: ${error.message}`);
    }
    console.log(`  ✓ ${pages.length}ページ / テキストあり ${rows.length}ページ`);

    if (makeDrafts) {
      const drafts = [];
      pages.forEach((text, i) => {
        const d = draftCard(text, title, i + 1);
        if (d) {
          drafts.push({
            user_id: userId,
            deck: `下書き:${title}`,
            front: d.front,
            back: d.back,
            origin: 'material',
            origin_ref: `${mat.id}#${i + 1}`,
            source_material_id: mat.id,
            source_page: i + 1,
            note: `${title} p.${i + 1}`,
            suspended: true, // 目で確認してから復習キューに入れる
          });
        }
      });
      for (const part of chunk(drafts, 100)) {
        const { error } = await supabase
          .from('cards')
          .upsert(part, { onConflict: 'user_id,origin,origin_ref', ignoreDuplicates: true });
        if (error) console.warn(`  下書きカード保存で警告: ${error.message}`);
      }
      console.log(`  ✓ 下書きカード ${drafts.length}枚（保留状態。アプリの「カード」で確認して復帰）`);
    }
  }

  console.log('\n完了。アプリの「資料」タブで開けます。');
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
