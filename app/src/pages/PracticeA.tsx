import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ExamSitting, Question, Section } from '../lib/types';

type Mode = 'sitting' | 'random' | 'wrong';

function shuffle<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export default function PracticeA() {
  const [sittings, setSittings] = useState<ExamSitting[]>([]);
  const [section, setSection] = useState<Section>('a2');
  const [mode, setMode] = useState<Mode>('sitting');
  const [sitting, setSitting] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bankCount, setBankCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [sessionStats, setSessionStats] = useState({ n: 0, ok: 0 });

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

  useEffect(() => {
    supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .in('section', ['a1', 'a2'])
      .then(({ count }) => setBankCount(count ?? 0));
  }, []);

  const start = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setQuestions([]);
    setIdx(0);
    setPicked(null);
    setSessionStats({ n: 0, ok: 0 });

    try {
      if (mode === 'wrong') {
        const { data: att, error: e1 } = await supabase
          .from('question_attempts')
          .select('question_id')
          .eq('correct', false)
          .order('attempted_at', { ascending: false })
          .limit(500);
        if (e1) throw e1;
        const ids = [...new Set((att ?? []).map((a: { question_id: string }) => a.question_id))];
        if (ids.length === 0) {
          setQuestions([]);
          setLoading(false);
          return;
        }
        const { data, error } = await supabase
          .from('questions')
          .select('*')
          .in('id', ids)
          .in('section', ['a1', 'a2']);
        if (error) throw error;
        setQuestions(shuffle((data ?? []) as Question[]).slice(0, 50));
      } else {
        let query = supabase.from('questions').select('*').eq('section', section);
        if (mode === 'sitting') query = query.eq('sitting_code', sitting).order('number');
        const { data, error } = await query.limit(mode === 'random' ? 600 : 100);
        if (error) throw error;
        const rows = (data ?? []) as Question[];
        setQuestions(mode === 'random' ? shuffle(rows).slice(0, 25) : rows);
      }
      setStartedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mode, section, sitting]);

  const q = questions[idx];

  async function answer(key: string) {
    if (!q || picked) return;
    setPicked(key);
    const ok = q.correct === key;
    setSessionStats((s) => ({ n: s.n + 1, ok: s.ok + (ok ? 1 : 0) }));

    const { data: u } = await supabase.auth.getUser();
    await supabase.from('question_attempts').insert({
      user_id: u.user!.id,
      question_id: q.id,
      selected: key,
      correct: ok,
      elapsed_ms: Math.min(Date.now() - startedAt, 1000 * 60 * 20),
    });
    if (!ok) {
      // 間違えた問題は復習キューへ
      await supabase.rpc('ensure_question_card', { p_question_id: q.id });
    }
  }

  function next() {
    setPicked(null);
    setStartedAt(Date.now());
    setIdx((i) => i + 1);
  }

  const current = sittings.find((s) => s.code === sitting);

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="sec" style={{ margin: 0 }}>科目A 過去問ドリル</h2>
          <Link className="btn btn-sm" to="/practice/b">
            科目B へ →
          </Link>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <select value={section} onChange={(e) => setSection(e.target.value as Section)} style={{ maxWidth: 180 }}>
            <option value="a2">科目A-2（午前Ⅱ）</option>
            <option value="a1">科目A-1（午前Ⅰ）</option>
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={{ maxWidth: 180 }}>
            <option value="sitting">年度を選ぶ</option>
            <option value="random">ランダム25問</option>
            <option value="wrong">誤答のみ</option>
          </select>
          {mode === 'sitting' && (
            <select value={sitting} onChange={(e) => setSitting(e.target.value)} style={{ maxWidth: 180 }}>
              {sittings.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => void start()} disabled={loading}>
            開始
          </button>
        </div>
      </div>

      {err && <div className="alert alert-err">{err}</div>}

      {bankCount === 0 && (
        <div className="card">
          <h2 className="sec">まず問題を取り込む</h2>
          <p className="small" style={{ marginTop: 0 }}>
            問題はまだ取り込まれていません。Mac のターミナルでリポジトリの <code>tools/</code> に移動し、
            次を実行すると IPA 公表の過去問PDFを取得して問題バンクに取り込みます。
          </p>
          <pre
            className="pagetext"
            style={{ background: 'var(--bg-soft)', padding: 10, borderRadius: 10, maxHeight: 'none' }}
          >{`cd tools
npm install
npm run download          # IPA の過去問PDFをダウンロード
npm run ingest:past-exams # 科目A-1 / A-2 を問題バンクへ`}</pre>
          <p className="mute2" style={{ marginBottom: 0 }}>
            取り込みが終わるまでは、下のリンクから過去問道場でそのまま演習できます。
          </p>
        </div>
      )}

      {current && (
        <div className="card">
          <h2 className="sec">{current.label} の外部リンク</h2>
          <div className="row-tight">
            {current.siken_base && (
              <a className="btn btn-sm" href={current.siken_base} target="_blank" rel="noreferrer">
                過去問道場で解く
              </a>
            )}
            {current.ipa_urls.am2_qs && (
              <a className="btn btn-sm" href={current.ipa_urls.am2_qs} target="_blank" rel="noreferrer">
                午前Ⅱ 問題PDF
              </a>
            )}
            {current.ipa_urls.am2_ans && (
              <a className="btn btn-sm" href={current.ipa_urls.am2_ans} target="_blank" rel="noreferrer">
                午前Ⅱ 解答
              </a>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div className="card row" style={{ justifyContent: 'center' }}>
          <div className="spinner" />
        </div>
      )}

      {!loading && questions.length > 0 && !q && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 30 }}>🎯</div>
          <h2 style={{ fontSize: 18, margin: '6px 0' }}>
            {sessionStats.ok} / {sessionStats.n} 正解
          </h2>
          <p className="mute2">
            間違えた問題は復習カードとして自動で登録されました。
            <Link to="/review"> 復習へ</Link>
          </p>
          <button className="btn" onClick={() => void start()}>
            もう一度
          </button>
        </div>
      )}

      {q && (
        <div className="card">
          <div className="row small muted" style={{ justifyContent: 'space-between' }}>
            <span>
              {idx + 1} / {questions.length}
            </span>
            <span className="row-tight">
              <span className="pill">{q.sitting_code}</span>
              <span className="pill">問{q.number}</span>
              {sessionStats.n > 0 && (
                <span className="pill">
                  正答 {Math.round((sessionStats.ok / sessionStats.n) * 100)}%
                </span>
              )}
            </span>
          </div>

          <div className="qbody" style={{ margin: '12px 0 16px' }}>
            {q.body}
          </div>

          <div className="choices">
            {Object.entries(q.choices ?? {}).map(([key, text]) => {
              let cls = 'choice';
              if (picked) {
                if (key === q.correct) cls += ' correct';
                else if (key === picked) cls += ' wrong';
              }
              return (
                <button key={key} className={cls} disabled={!!picked} onClick={() => void answer(key)}>
                  <span className="mark">{key}</span>
                  <span className="grow">{text}</span>
                </button>
              );
            })}
          </div>

          {picked && (
            <div style={{ marginTop: 14 }}>
              <div className={`alert ${picked === q.correct ? 'alert-ok' : 'alert-err'}`}>
                {picked === q.correct ? '正解' : `不正解（正解は ${q.correct}）`}
              </div>
              {q.explanation && (
                <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
                  {q.explanation}
                </p>
              )}
              <p className="mute2" style={{ margin: '8px 0' }}>
                {q.attribution}
              </p>
              <div className="row">
                {q.siken_url && (
                  <a className="btn btn-sm" href={q.siken_url} target="_blank" rel="noreferrer">
                    過去問道場の解説
                  </a>
                )}
                <button
                  className="btn btn-sm"
                  onClick={() => void supabase.rpc('ensure_question_card', { p_question_id: q.id })}
                >
                  復習カードに追加
                </button>
                <div className="grow" />
                <button className="btn btn-primary btn-sm" onClick={next}>
                  次へ
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && questions.length === 0 && bankCount !== 0 && mode === 'wrong' && (
        <div className="card">
          <p className="mute2" style={{ margin: 0 }}>
            誤答の記録がありません。まずは年度を選んで解いてみてください。
          </p>
        </div>
      )}
    </div>
  );
}
