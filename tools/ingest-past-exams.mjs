#!/usr/bin/env node
/**
 * ダウンロード済みの IPA 過去問PDF（過去問/<試験回>/）から
 * 科目A-1（午前Ⅰ）/ 科目A-2（午前Ⅱ）の四肢択一を問題バンクへ取り込む。
 *
 *   node ingest-past-exams.mjs                   # 全試験回
 *   node ingest-past-exams.mjs --sitting 07_aki
 *   node ingest-past-exams.mjs --only am2
 *   node ingest-past-exams.mjs --dry-run         # 書き込まず、抽出できた件数だけ表示
 *   node ingest-past-exams.mjs --dump out.json   # 抽出結果をJSONに書き出して目視確認
 *
 * PDF のレイアウトは年度によって揺れるため、抽出は完璧ではない。
 * --dry-run で「25問中いくつ取れたか」を必ず確認してから本番実行するのが安全。
 * 取りこぼした問題はアプリから過去問道場のリンクで解ける。
 */
import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect, arg, hasFlag, chunk, REPO_DIR } from './lib/db.mjs';
import { extractPages, normalize, stripChrome } from './lib/pdf.mjs';

const PAST_DIR = resolve(REPO_DIR, '過去問');
const EXPECTED = { a1: 30, a2: 25 };
const MARKS = ['ア', 'イ', 'ウ', 'エ'];

/** 「令和7年秋期」→「令和7年度 秋期」 */
function toNengo(label) {
  return label.replace(/^(.+?年)(春|秋|特別)期$/, '$1度 $2期');
}

const SECTION_JA = { a1: '午前Ⅰ', a2: '午前Ⅱ' };

/** 問題PDFのテキストから 四肢択一を取り出す */
function parseQuestions(fullText) {
  const text = stripChrome(normalize(fullText));
  // 「問12」で始まる位置で分割
  const parts = text.split(/\n(?=問\s*\d{1,2}\s)/);
  const out = [];

  for (const part of parts) {
    const head = part.match(/^問\s*(\d{1,2})\s*([\s\S]*)$/);
    if (!head) continue;
    const number = Number(head[1]);
    const rest = head[2];

    // ア〜エ を順番に拾う。各選択肢は非貪欲、最後だけ貪欲。
    const m = rest.match(
      /^([\s\S]*?)(?:^|\n|\s)ア[ 　]*([\s\S]*?)(?:^|\n|\s)イ[ 　]*([\s\S]*?)(?:^|\n|\s)ウ[ 　]*([\s\S]*?)(?:^|\n|\s)エ[ 　]*([\s\S]*)$/,
    );
    if (!m) continue;

    const body = m[1].trim();
    const choiceTexts = [m[2], m[3], m[4], m[5]].map((s) => s.replace(/\s+/g, ' ').trim());
    if (!body || body.length < 10) continue;
    if (choiceTexts.some((c) => !c || c.length < 1 || c.length > 500)) continue;

    const choices = {};
    MARKS.forEach((k, i) => (choices[k] = choiceTexts[i]));
    out.push({ number, body, choices });
  }

  // 同じ問番号が複数取れたら最初のものを採用
  const seen = new Map();
  for (const q of out) if (!seen.has(q.number)) seen.set(q.number, q);
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

/** 解答PDFのテキストから 問番号→記号 を取り出す */
function parseAnswers(fullText, expected) {
  const text = normalize(fullText);
  const map = new Map();

  // 方式1: 「問1 ウ」のように番号と記号が並んでいる
  for (const m of text.matchAll(/問\s*(\d{1,2})[^\S\n]*[\n ]?[^\S\n]*([アイウエ])/g)) {
    const n = Number(m[1]);
    if (!map.has(n)) map.set(n, m[2]);
  }
  if (map.size >= expected * 0.8) return map;

  // 方式2: 番号の行と記号の行が分かれている表組み
  const marks = [...text.matchAll(/(?:^|[\s|])([アイウエ])(?=$|[\s|])/gm)].map((m) => m[1]);
  if (marks.length >= expected) {
    const m2 = new Map();
    for (let i = 0; i < expected; i++) m2.set(i + 1, marks[i]);
    // 方式1 で取れていたぶんは優先して残す
    for (const [k, v] of map) m2.set(k, v);
    return m2;
  }
  return map;
}

async function filesIn(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function main() {
  const { supabase, userId } = await connect();
  const dry = hasFlag('dry-run');
  // --only は am1 / am2（ダウンロード側の呼び方）でも a1 / a2 でも受け付ける
  const onlyRaw = arg('only', null);
  const only = onlyRaw ? { am1: 'a1', am2: 'a2', a1: 'a1', a2: 'a2' }[String(onlyRaw)] ?? null : null;
  if (onlyRaw && !only) {
    console.warn(`--only ${onlyRaw} は不明です。am1 / am2 を指定してください。全区分を対象にします。`);
  }
  const onlySitting = arg('sitting', null);
  const dumpPath = arg('dump', null);

  let q = supabase.from('exam_sittings').select('*').order('sort_key', { ascending: false });
  if (onlySitting) q = q.eq('code', onlySitting);
  const { data: sittings, error } = await q;
  if (error) throw error;

  const dump = [];
  let inserted = 0;
  const report = [];

  for (const s of sittings) {
    const dir = resolve(PAST_DIR, s.code);
    const names = await filesIn(dir);
    if (names.length === 0) continue;

    for (const section of ['a1', 'a2']) {
      if (only && only !== section) continue;
      const tag = section === 'a1' ? 'am1' : 'am2';
      const qsName = names.find((n) => n.includes(`_${tag}_qs.pdf`));
      const ansName = names.find((n) => n.includes(`_${tag}_ans.pdf`));
      if (!qsName || !ansName) continue;

      const qsPages = await extractPages(resolve(dir, qsName));
      const ansPages = await extractPages(resolve(dir, ansName));

      const questions = parseQuestions(qsPages.join('\n'));
      const answers = parseAnswers(ansPages.join('\n'), EXPECTED[section]);

      const rows = [];
      for (const item of questions) {
        const correct = answers.get(item.number);
        if (!correct) continue;
        rows.push({
          user_id: userId,
          sitting_code: s.code,
          section,
          number: item.number,
          body: item.body,
          choices: item.choices,
          correct,
          siken_url: s.siken_base ? `${s.siken_base}${tag}_${item.number}.html` : null,
          attribution: `出典：${toNengo(s.label)} 情報処理安全確保支援士試験 ${SECTION_JA[section]} 問${item.number}`,
        });
      }

      report.push({
        sitting: s.label,
        section,
        expected: EXPECTED[section],
        parsedQuestions: questions.length,
        parsedAnswers: answers.size,
        usable: rows.length,
      });

      if (dumpPath) dump.push(...rows);

      if (!dry && rows.length > 0) {
        for (const part of chunk(rows, 50)) {
          const { error: ie } = await supabase
            .from('questions')
            .upsert(part, { onConflict: 'user_id,sitting_code,section,number' });
          if (ie) {
            console.warn(`  ✗ ${s.label} ${section}: ${ie.message}`);
          } else {
            inserted += part.length;
          }
        }
      }
    }
  }

  console.log('\n抽出結果');
  console.log('試験回'.padEnd(14), '区分', '期待', '問題', '解答', '登録可');
  for (const r of report) {
    console.log(
      String(r.sitting).padEnd(14),
      r.section.padEnd(4),
      String(r.expected).padStart(4),
      String(r.parsedQuestions).padStart(4),
      String(r.parsedAnswers).padStart(4),
      String(r.usable).padStart(6),
      r.usable < r.expected ? '  ← 取りこぼしあり' : '',
    );
  }

  if (dumpPath) {
    await writeFile(resolve(REPO_DIR, String(dumpPath)), JSON.stringify(dump, null, 2), 'utf8');
    console.log(`\nJSON を書き出しました: ${dumpPath}（${dump.length}件）`);
  }

  if (dry) {
    console.log('\n--dry-run なので書き込みはしていません。');
  } else {
    console.log(`\n${inserted} 問を問題バンクに登録しました。`);
    console.log('取りこぼした問題は、アプリの「問題」から過去問道場のリンクで解けます。');
  }
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
