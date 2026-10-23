#!/usr/bin/env node
/**
 * Supabase Storage にアップロード済みの資料PDFをすべて削除する。
 * DBのページテキスト（material_pages）には触らない。
 *
 *   node purge-storage.mjs --dry-run   # 消す対象を表示するだけ
 *   node purge-storage.mjs             # 実際に削除
 *   node purge-storage.mjs --with-text # ページテキストと資料レコードも消す
 */
import { connect, hasFlag } from './lib/db.mjs';

const BUCKET = 'materials';

async function main() {
  const { supabase, userId } = await connect();
  const dry = hasFlag('dry-run');
  const withText = hasFlag('with-text');

  const { data: files, error } = await supabase.storage.from(BUCKET).list(userId, { limit: 1000 });
  if (error) throw error;

  if (!files || files.length === 0) {
    console.log('ストレージに対象ファイルはありません。');
  } else {
    const paths = files.map((f) => `${userId}/${f.name}`);
    const mb = files.reduce((n, f) => n + (f.metadata?.size ?? 0), 0) / 1048576;
    console.log(`対象: ${paths.length} ファイル / ${mb.toFixed(1)} MB`);
    for (const f of files) {
      console.log(`  - ${f.name} (${((f.metadata?.size ?? 0) / 1048576).toFixed(1)}MB)`);
    }
    if (!dry) {
      const { error: de } = await supabase.storage.from(BUCKET).remove(paths);
      if (de) throw de;
      const { error: ue } = await supabase
        .from('materials').update({ storage_path: null }).eq('user_id', userId);
      if (ue) throw ue;
      console.log(`\n✓ ${paths.length} ファイルを削除し、materials.storage_path を空にしました。`);
    }
  }

  if (withText && !dry) {
    const { count: pc } = await supabase
      .from('material_pages').delete({ count: 'exact' }).eq('user_id', userId);
    const { count: mc } = await supabase
      .from('materials').delete({ count: 'exact' }).eq('user_id', userId);
    console.log(`✓ ページテキスト ${pc ?? 0} 行、資料レコード ${mc ?? 0} 件も削除しました。`);
  }

  if (dry) console.log('\n--dry-run なので何も削除していません。');
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
