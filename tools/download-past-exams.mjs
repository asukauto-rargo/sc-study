#!/usr/bin/env node
/**
 * IPA が公表している過去問PDFを 過去問/<試験回>/ にダウンロードする。
 *
 *   node download-past-exams.mjs                 # 全試験回・全区分
 *   node download-past-exams.mjs --years 5       # 直近5試験回だけ
 *   node download-past-exams.mjs --only am2      # 午前Ⅱだけ
 *   node download-past-exams.mjs --sitting 07_aki
 *
 * IPA は公表済みの過去問題の利用を許諾しており、許諾申請や使用料は不要。
 * ただし著作権は放棄されていないため、出典の明記が必要。
 * 取り込み時に questions.attribution へ自動で出典を入れている。
 * https://www.ipa.go.jp/shiken/faq.html
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect, arg, REPO_DIR } from './lib/db.mjs';

const OUT_DIR = resolve(REPO_DIR, '過去問');
const SLEEP_MS = 700; // IPA のサーバに連続アクセスしないよう間隔をあける

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(p) {
  try {
    const s = await stat(p);
    return s.size > 1024;
  } catch {
    return false;
  }
}

async function main() {
  const { supabase } = await connect();

  const limit = Number(arg('years', 0)) || 0;
  const only = arg('only', null); // am1 | am2 | pm
  const onlySitting = arg('sitting', null);

  let q = supabase.from('exam_sittings').select('*').order('sort_key', { ascending: false });
  if (onlySitting) q = q.eq('code', onlySitting);
  const { data: sittings, error } = await q;
  if (error) throw error;

  const targets = limit ? sittings.slice(0, limit) : sittings;
  console.log(`対象: ${targets.length} 試験回`);

  let got = 0;
  let skipped = 0;
  let failed = 0;

  for (const s of targets) {
    const dir = resolve(OUT_DIR, s.code);
    await mkdir(dir, { recursive: true });

    for (const [key, url] of Object.entries(s.ipa_urls)) {
      if (only && !key.startsWith(only)) continue;
      const name = url.split('/').pop();
      const dest = resolve(dir, name);

      if (await exists(dest)) {
        skipped++;
        continue;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1024) throw new Error(`サイズが小さすぎる (${buf.length} bytes)`);
        await writeFile(dest, buf);
        got++;
        console.log(`  ↓ ${s.label} ${key}  ${(buf.length / 1024).toFixed(0)}KB`);
      } catch (e) {
        failed++;
        console.warn(`  ✗ ${s.label} ${key}: ${e.message}`);
      }
      await sleep(SLEEP_MS);
    }
  }

  console.log(`\n完了: 取得 ${got} / 既存 ${skipped} / 失敗 ${failed}`);
  console.log(`保存先: ${OUT_DIR}`);
  if (got > 0) console.log('次に: npm run ingest:past-exams');
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
