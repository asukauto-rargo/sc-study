import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ExamSitting, Section } from '../lib/types';

type Mode = 'sitting' | 'wrong';

const COUNT: Record<'a1' | 'a2', number> = { a1: 30, a2: 25 };
const SECTION_JA: Record<'a1' | 'a2', string> = { a1: '午前Ⅰ', a2: '午前Ⅱ' };

interface Attempt {
  sitting_code: string;
  section: Section;
  number: number;
  correct: boolean | null;
}

/** 「令和7年秋期」→「令和7年度 秋期」 */
function toNengo(label: string) {
  return label.replace(/^(.+?年)(春|秋|特別)期$/, '$1度 $2期');
}

export default function PracticeA() {
  const [sittings, setSittings] = useState<ExamSitting[]>([]);
  const [section, setSection] = useState<'a1' | 'a2'>('a2');
  const [sitting, setSitting] = useState('');
  const [mode, setMode] = useState<Mode>('sitting');

  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [cardDraft, setCardDraft] = useState<{ front: string; back: string } | null>(null);

  useEffect(() => {
    supabase
      .from('exam_sittings')
      .select('*')
      .order('sort_key', { ascending: false })
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else {
          const rows = (data ?? []) as ExamSitting[];
          setSittings(rows);
          if (rows[0]) setSitting(rows[0].code);
        }
      });
  }, []);

  const loadAttempts = useCallback(async () => {
    const { data, error } = await supabase
      .from('question_attempts')
      .select('correct, questions!inner(sitting_code, section, number)')
      .in('questions.section', ['a1', 'a2'])
      .order('attempted_at', { ascending: false })
      .limit(2000);
    if (error) {
      setErr(error.message);
      return;
    }
    type Row = { correct: boolean | null; questions: { sitting_code: string; section: Section; number: number } };
    // 同じ問題は最新の結果だけ残す
    const seen = new Set<string>();
    const out: Attempt[] = [];
    for (const r of (data ?? []) as unknown as Row[]) {
      const k = `${r.questions.sitting_code}:${r.questions.section}:${r.questions.number}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...r.questions, correct: r.correct });
    }
    setAttempts(out);
  }, []);

  useEffect(() => {
    void loadAttempts();
  }, [loadAttempts]);

  const current = sittings.find((s) => s.code === sitting);
  const total = COUNT[section];

  const resultOf = useCallback(
    (code: string, sec: Section, n: number) =>
      attempts.find((a) => a.sitting_code === code && a.section === sec && a.number === n)?.correct ??
      null,
    [attempts],
  );

  const stats = useMemo(() => {
    const here = attempts.filter((a) => a.sitting_code === sitting && a.section === section);
    const done = here.length;
    const ok = here.filter((a) => a.correct).length;
    return { done, ok, pct: done ? Math.round((ok / done) * 100) : 0 };
  }, [attempts, sitting, section]);

  const wrongList = useMemo(
    () => attempts.filter((a) => a.correct === false).sort((a, b) =>
      a.sitting_code === b.sitting_code ? a.number - b.number : a.sitting_code < b.sitting_code ? 1 : -1),
    [attempts],
  );

  function sikenUrl(code: string, sec: Section, n: number) {
    const base = sittings.find((s) => s.code === code)?.siken_base;
    if (!base) return null;
    return `${base}${sec === 'a1' ? 'am1' : 'am2'}_${n}.html`;
  }

  function openQuestion(n: number) {
    setSelected(n);
    setCardDraft(null);
    const url = sikenUrl(sitting, section, n);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  /** 記録用の問題行を用意する（問題文は持たず、出典と場所だけ） */
  async function ensureQuestionId(code: string, sec: Section, n: number): Promise<string> {
    const { data: u } = await supabase.auth.getUser();
    const label = sittings.find((s) => s.code === code)?.label ?? code;
    const { data, error } = await supabase
      .from('questions')
      .upsert(
        {
          user_id: u.user!.id,
          sitting_code: code,
          section: sec,
          number: n,
          body: '（問題文はIPA公表PDF／過去問道場を参照）',
          siken_url: sikenUrl(code, sec, n),
          attribution: `出典：${toNengo(label)} 情報処理安全確保支援士試験 ${SECTION_JA[sec as 'a1' | 'a2']} 問${n}`,
        },
        { onConflict: 'user_id,sitting_code,section,number' },
      )
      .select('id')
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  }

  async function record(n: number, correct: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const qid = await ensureQuestionId(sitting, section, n);
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('question_attempts')
        .insert({ user_id: u.user!.id, question_id: qid, correct });
      if (error) throw error;
      await loadAttempts();

      if (correct) {
        // 次の未解答へ進む
        const next = Array.from({ length: total }, (_, i) => i + 1).find(
          (x) => x > n && resultOf(sitting, section, x) === null,
        );
        setSelected(next ?? null);
        setToast(`問${n} ○`);
        setTimeout(() => setToast(null), 1500);
      } else {
        // 間違えたら、その場でカードを書いてもらう
        setCardDraft({ front: '', back: '' });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveCard() {
    if (!cardDraft || selected === null) return;
    if (!cardDraft.front.trim() || !cardDraft.back.trim()) {
      setErr('表と裏の両方を入力してください。');
      return;
    }
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const label = current?.label ?? sitting;
      const { error } = await supabase.from('cards').insert({
        user_id: u.user!.id,
        deck: section === 'a1' ? '科目A-1' : '科目A-2',
        front: cardDraft.front.trim(),
        back: cardDraft.back.trim(),
        note: `${label} ${SECTION_JA[section]} 問${selected}`,
        tags: [sitting, section],
        origin: 'manual',
        origin_ref: `q:${sitting}:${section}:${selected}:${Date.now()}`,
      });
      if (error) throw error;
      setCardDraft(null);
      setToast('復習カードに追加しました');
      setTimeout(() => setToast(null), 2500);
      const next = Array.from({ length: total }, (_, i) => i + 1).find(
        (x) => x > selected && resultOf(sitting, section, x) === null,
      );
      setSelected(next ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="sec" style={{ margin: 0 }}>科目A 演習記録</h2>
          <Link className="btn btn-sm" to="/practice/b">科目B へ →</Link>
        </div>
        <p className="mute2" style={{ marginTop: 8 }}>
          番号を押すと過去問道場でその問題が開きます。解いて解説まで読んだら、戻って ○ か × を押してください。
          × を押すとその場で復習カードを作れます。
        </p>

        <div className="row">
          <select value={mode} onChange={(e) => { setMode(e.target.value as Mode); setSelected(null); }}
                  style={{ maxWidth: 150 }}>
            <option value="sitting">年度別</option>
            <option value="wrong">誤答一覧</option>
          </select>
          {mode === 'sitting' && (
            <>
              <select value={section} onChange={(e) => { setSection(e.target.value as 'a1' | 'a2'); setSelected(null); }}
                      style={{ maxWidth: 170 }}>
                <option value="a2">科目A-2（午前Ⅱ）</option>
                <option value="a1">科目A-1（午前Ⅰ）</option>
              </select>
              <select value={sitting} onChange={(e) => { setSitting(e.target.value); setSelected(null); }}
                      style={{ maxWidth: 170 }}>
                {sittings.map((s) => (
                  <option key={s.code} value={s.code}>{s.label}</option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      {err && <div className="alert alert-err">{err}</div>}
      {toast && <div className="alert alert-ok">{toast}</div>}

      {mode === 'sitting' && (
        <>
          <div className="card">
            <div className="row small muted" style={{ justifyContent: 'space-between' }}>
              <span>{stats.done} / {total} 記録済み</span>
              {stats.done > 0 && <span>正答率 {stats.pct}%（{stats.ok}問正解）</span>}
            </div>
            <div className="progress" style={{ marginTop: 8 }}>
              <i style={{ width: `${(stats.done / total) * 100}%` }} />
            </div>

            <div className="numgrid" style={{ marginTop: 14 }}>
              {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
                const r = resultOf(sitting, section, n);
                const cls = r === true ? ' ok' : r === false ? ' ng' : '';
                const sel = selected === n ? ' sel' : '';
                return (
                  <button key={n} className={`numcell${cls}${sel}`} onClick={() => openQuestion(n)}>
                    {n}
                  </button>
                );
              })}
            </div>

            {current?.siken_base && (
              <div className="row-tight" style={{ marginTop: 14 }}>
                <a className="btn btn-sm" href={current.siken_base} target="_blank" rel="noreferrer">
                  この回の一覧を開く
                </a>
                {current.ipa_urls[section === 'a1' ? 'am1_qs' : 'am2_qs'] && (
                  <a className="btn btn-sm"
                     href={current.ipa_urls[section === 'a1' ? 'am1_qs' : 'am2_qs']}
                     target="_blank" rel="noreferrer">
                    IPA 問題PDF
                  </a>
                )}
              </div>
            )}
          </div>

          {selected !== null && (
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{current?.label} {SECTION_JA[section]} 問{selected}</strong>
                {sikenUrl(sitting, section, selected) && (
                  <a className="btn btn-sm" href={sikenUrl(sitting, section, selected)!}
                     target="_blank" rel="noreferrer">
                    もう一度開く
                  </a>
                )}
              </div>

              {!cardDraft ? (
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn btn-block good-btn" disabled={busy}
                          onClick={() => void record(selected, true)}>
                    ○ できた
                  </button>
                  <button className="btn btn-block again-btn" disabled={busy}
                          onClick={() => void record(selected, false)}>
                    × 間違えた
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <p className="mute2" style={{ marginTop: 0 }}>
                    この問題で分かっていなかったことを、自分の言葉で書いてください。
                    問題文の写しではなく、要点を問いの形にするほど定着します。
                  </p>
                  <label className="field">
                    <span>表（問い）</span>
                    <textarea value={cardDraft.front} autoFocus
                              onChange={(e) => setCardDraft({ ...cardDraft, front: e.target.value })}
                              placeholder="例: DNSキャッシュポイズニングのカミンスキー攻撃への対策は？"
                              style={{ minHeight: 80 }} />
                  </label>
                  <label className="field">
                    <span>裏（答え）</span>
                    <textarea value={cardDraft.back}
                              onChange={(e) => setCardDraft({ ...cardDraft, back: e.target.value })}
                              style={{ minHeight: 120 }} />
                  </label>
                  <div className="row">
                    <button className="btn btn-primary" disabled={busy} onClick={() => void saveCard()}>
                      カードにする
                    </button>
                    <button className="btn" onClick={() => { setCardDraft(null); setSelected(null); }}>
                      作らずに次へ
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {mode === 'wrong' && (
        <div className="card">
          <h2 className="sec">間違えた問題</h2>
          {wrongList.length === 0 ? (
            <p className="mute2" style={{ margin: 0 }}>
              まだ記録がありません。年度別から解いてみてください。
            </p>
          ) : (
            <>
              <p className="mute2" style={{ marginTop: 0 }}>{wrongList.length}問</p>
              {wrongList.map((a) => {
                const label = sittings.find((s) => s.code === a.sitting_code)?.label ?? a.sitting_code;
                const url = sikenUrl(a.sitting_code, a.section, a.number);
                return (
                  <div className="list-item" key={`${a.sitting_code}-${a.section}-${a.number}`}>
                    <div className="grow">
                      <div className="t">{label} {SECTION_JA[a.section as 'a1' | 'a2']} 問{a.number}</div>
                    </div>
                    {url && (
                      <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">
                        開く
                      </a>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
