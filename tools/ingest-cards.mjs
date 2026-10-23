#!/usr/bin/env node
/**
 * seeds/*.json にまとめた復習カードを取り込む。
 *
 *   node ingest-cards.mjs                       # seeds/ 配下の *.json すべて
 *   node ingest-cards.mjs --file ../seeds/cards.local.json
 *   node ingest-cards.mjs --suspended           # 保留状態で入れる（内容を見てから有効化）
 *
 * JSON の形式:
 *   [{ "deck": "暗号技術", "front": "…", "back": "…", "note": "…", "tags": ["…"], "key": "crypto-001" }]
 *
 * key は再実行時の重複防止に使う。省略すると deck+front から自動生成する。
 * 購入教材から作ったカードは seeds/*.local.json に置くこと（.gitignore 済み）。
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, resolve } from 'node:path';
import { connect, arg, hasFlag, chunk, REPO_DIR } from './lib/db.mjs';

const SEEDS_DIR = resolve(REPO_DIR, 'seeds');

async function main() {
  const { supabase, userId } = await connect();
  const suspended = hasFlag('suspended');
  const one = arg('file', null);

  let files;
  if (one) {
    files = [resolve(REPO_DIR, String(one))];
  } else {
    const names = await readdir(SEEDS_DIR).catch(() => []);
    files = names.filter((n) => extname(n) === '.json').map((n) => resolve(SEEDS_DIR, n));
  }

  if (files.length === 0) {
    console.log(`JSON が見つかりません: ${SEEDS_DIR}`);
    return;
  }

  let total = 0;
  for (const file of files) {
    const items = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(items)) {
      console.warn(`✗ ${file}: 配列ではありません`);
      continue;
    }

    const rows = items
      .filter((it) => it && it.front && it.back)
      .map((it) => {
        const key =
          it.key ??
          createHash('sha1').update(`${it.deck ?? ''}|${it.front}`).digest('hex').slice(0, 20);
        return {
          user_id: userId,
          deck: it.deck ?? '未分類',
          front: String(it.front),
          back: String(it.back),
          note: it.note ? String(it.note) : null,
          tags: Array.isArray(it.tags) ? it.tags : [],
          origin: 'material',
          origin_ref: `seed:${key}`,
          suspended,
        };
      });

    for (const part of chunk(rows, 100)) {
      const { error } = await supabase
        .from('cards')
        .upsert(part, { onConflict: 'user_id,origin,origin_ref', ignoreDuplicates: true });
      if (error) throw new Error(`${file}: ${error.message}`);
    }
    total += rows.length;
    console.log(`✓ ${file.split('/').pop()}  ${rows.length}枚`);
  }

  console.log(`\n合計 ${total}枚 を取り込みました（既存ぶんは重複登録しません）。`);
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
