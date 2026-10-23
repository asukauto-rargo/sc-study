#!/usr/bin/env node
/**
 * seeds/*.json にまとめた復習カードを取り込む。
 *
 *   node ingest-cards.mjs                       # seeds/ 配下の *.json すべて
 *   node ingest-cards.mjs --file ../seeds/cards.local.json
 *   node ingest-cards.mjs --suspended           # 保留状態で入れる（内容を見てから有効化）
 *   node ingest-cards.mjs --dry-run             # 件数だけ確認
 *
 * JSON の形式:
 *   [{ "deck": "暗号技術", "front": "…", "back": "…", "note": "…", "tags": ["…"], "key": "crypto-001" }]
 *
 * key は再実行時の重複防止に使う。省略すると deck+front から自動生成する。
 * 既に入っているカード（origin_ref が一致）は飛ばすので、何度実行しても安全。
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, resolve, basename } from 'node:path';
import { connect, arg, hasFlag, chunk, REPO_DIR } from './lib/db.mjs';

const SEEDS_DIR = resolve(REPO_DIR, 'seeds');

async function main() {
  const { supabase, userId } = await connect();
  const suspended = hasFlag('suspended');
  const dry = hasFlag('dry-run');
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

  // 既に入っているカードの origin_ref を集める（重複登録を避けるため）
  const existing = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('cards')
      .select('origin_ref')
      .not('origin_ref', 'is', null)
      .range(from, from + 999);
    if (error) throw new Error(`既存カードの取得に失敗: ${error.message}`);
    for (const r of data ?? []) existing.add(r.origin_ref);
    if (!data || data.length < 1000) break;
  }
  console.log(`既存カード: ${existing.size}枚`);

  let added = 0;
  let skipped = 0;

  for (const file of files) {
    let items;
    try {
      items = JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      console.warn(`✗ ${basename(file)}: JSONとして読めません (${e.message})`);
      continue;
    }
    if (!Array.isArray(items)) {
      console.warn(`✗ ${basename(file)}: 配列ではありません`);
      continue;
    }

    const rows = [];
    for (const it of items) {
      if (!it || !it.front || !it.back) continue;
      const key =
        it.key ??
        createHash('sha1').update(`${it.deck ?? ''}|${it.front}`).digest('hex').slice(0, 20);
      const ref = `seed:${key}`;
      if (existing.has(ref)) {
        skipped++;
        continue;
      }
      existing.add(ref); // 同一ファイル内の重複も弾く
      rows.push({
        user_id: userId,
        deck: it.deck ?? '未分類',
        front: String(it.front),
        back: String(it.back),
        note: it.note ? String(it.note) : null,
        tags: Array.isArray(it.tags) ? it.tags : [],
        origin: 'manual',
        origin_ref: ref,
        suspended,
      });
    }

    if (rows.length > 0 && !dry) {
      for (const part of chunk(rows, 100)) {
        const { error } = await supabase.from('cards').insert(part);
        if (error) throw new Error(`${basename(file)}: ${error.message}`);
      }
    }
    added += rows.length;
    console.log(`${dry ? '…' : '✓'} ${basename(file)}  新規 ${rows.length}枚`);
  }

  if (dry) {
    console.log(`\n--dry-run: 新規 ${added}枚 / 既存のため飛ばす ${skipped}枚`);
  } else {
    console.log(`\n${added}枚を追加しました（既存のため飛ばしたもの: ${skipped}枚）。`);
    if (added > 0) console.log('アプリを再読み込みすると、ホームに復習枚数が出ます。');
  }
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
