import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ExamSitting, Question, QuestionAttempt } from '../lib/types';
import { fmtDateTime } from '../lib/format';

const TARGET_MIN = 75; // 科目B は 150分で2問 → 1問75分

function mmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function PracticeB() {
  const [sittings, setSittings] = useState<ExamSitting[]>([]);
  const [sitting, setSitting] = useState('');
  const [number, setNumber] = useState(1);
  const [imported, setImported] = useState<Question | null>(null);
  const [answer, setAnswer] = useState('');
  const [score, setScore] = useState<number | ''>('');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<(QuestionAttempt & { questions: Question })[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tick = useRef<number | null>(null);

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

  // タイマー
  useEffect(() => {
    if (running) {
      tick.current = window.setInterval(() => setElapsed((e) => e + 1000), 1000);
    } else if (tick.current) {
      window.clearInterval(tick.current);
      tick.current = null;
    }
    return () => {
      if (tick.current) window.clearInterval(tick.current);
    };
  }, [running]);

  // 取り込み済みの科目B問題があれば本文を表示する
  useEffect(() => {
    if (!sitting) return;
    supabase
      .from('questions')
      .select('*')
      .eq('sitting_code', sitting)
      .eq('section', 'b')
      .eq('number', number)
      .maybeSingle()
      .then(({ data }) => setImported((data as Question | null) ?? null));
  }, [sitting, number]);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from('question_attempts')
      .select('*, questions!inner(*)')
      .eq('questions.section', 'b')
      .order('attempted_at', { ascending: false })
      .limit(20);
    setHistory((data ?? []) as (QuestionAttempt & { questions: Question })[]);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const current = sittings.find((s) => s.code === sitting);

  async function ensureQuestionId(): Promise<string> {
    if (imported) return imported.id;
    const { data: u } = await supabase.auth.getUser();
    const attribution = `出典：${current?.label ?? sitting} 情報処理安全確保支援士試験 午後 問${number}（IPA 公表問題）`;
    const { data, error } = await supabase
      .from('questions')
      .upsert(
        {
          user_id: u.user!.id,
          sitting_code: sitting,
          section: 'b',
          number,
          body: '（本文は IPA 公表の問題PDFを参照）',
          attribution,
        },
        { onConflict: 'user_id,sitting_code,section,number' },
      )
      .select('id')
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  }

  async function save() {
    setErr(null);
    setMsg(null);
    if (!answer.trim()) {
      setErr('解答を入力してください。');
      return;
    }
    try {
      const qid = await ensureQuestionId();
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from('question_attempts').insert({
        user_id: u.user!.id,
        question_id: qid,
        answer_text: answer,
        self_score: score === '' ? null : Number(score),
        correct: score === '' ? null : Number(score) >= 60,
        elapsed_ms: elapsed,
      });
      if (error) throw error;
      setMsg('記録しました。');
      setAnswer('');
      setScore('');
      setElapsed(0);
      setRunning(false);
      void loadHistory();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const over = elapsed > TARGET_MIN * 60 * 1000;

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="sec" style={{ margin: 0 }}>科目B 記述対策</h2>
          <Link className="btn btn-sm" to="/practice">
            ← 科目A へ
          </Link>
        </div>
        <p className="mute2" style={{ marginTop: 8 }}>
          本番はCBTで、長文を画面で読んでキーボードで解答します。問題PDFは紙に印刷せず、
          この画面の横で開いて解くのが本番に一番近い練習になります。
        </p>

        <div className="row">
          <select value={sitting} onChange={(e) => setSitting(e.target.value)} style={{ maxWidth: 190 }}>
            {sittings.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={number}
            onChange={(e) => setNumber(Number(e.target.value))}
            style={{ maxWidth: 120 }}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                問{n}
              </option>
            ))}
          </select>
        </div>

        {current && (
          <div className="row-tight" style={{ marginTop: 10 }}>
            {['pm_qs', 'pm1_qs', 'pm2_qs'].map(
              (k) =>
                current.ipa_urls[k] && (
                  <a key={k} className="btn btn-sm" href={current.ipa_urls[k]} target="_blank" rel="noreferrer">
                    {k === 'pm_qs' ? '午後 問題' : k === 'pm1_qs' ? '午後Ⅰ 問題' : '午後Ⅱ 問題'}
                  </a>
                ),
            )}
            {['pm_ans', 'pm1_ans', 'pm2_ans'].map(
              (k) =>
                current.ipa_urls[k] && (
                  <a key={k} className="btn btn-sm" href={current.ipa_urls[k]} target="_blank" rel="noreferrer">
                    {k === 'pm_ans' ? '解答例' : k === 'pm1_ans' ? '午後Ⅰ 解答例' : '午後Ⅱ 解答例'}
                  </a>
                ),
            )}
          </div>
        )}
      </div>

      {imported && (
        <div className="card">
          <h2 className="sec">問題本文（取り込み済み）</h2>
          <div className="qbody">{imported.body}</div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className={`timer ${over ? '' : ''}`} style={{ color: over ? 'var(--hard)' : undefined }}>
            {mmss(elapsed)}
          </span>
          <span className="row-tight">
            <button className="btn btn-sm" onClick={() => setRunning(!running)}>
              {running ? '一時停止' : '計測開始'}
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                setRunning(false);
                setElapsed(0);
              }}
            >
              リセット
            </button>
          </span>
        </div>
        <p className="mute2" style={{ margin: '6px 0 0' }}>
          目安 {TARGET_MIN}分／問（科目B は150分で2問）{over ? ' — 目安を超えました' : ''}
        </p>
      </div>

      <div className="card">
        <h2 className="sec">解答（キーボードで入力）</h2>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="設問ごとに改行して記述してください。字数制限のある設問は括弧で字数を書いておくと見直しやすいです。"
          style={{ minHeight: 220 }}
        />
        <p className="mute2" style={{ margin: '4px 0 12px' }}>
          {answer.length} 文字
        </p>

        <label className="field">
          <span>自己採点（0〜100・公式の解答例と採点講評を見てから）</span>
          <input
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(e.target.value === '' ? '' : Number(e.target.value))}
            style={{ maxWidth: 140 }}
          />
        </label>

        {err && <div className="alert alert-err" style={{ marginBottom: 10 }}>{err}</div>}
        {msg && <div className="alert alert-ok" style={{ marginBottom: 10 }}>{msg}</div>}

        <button className="btn btn-primary btn-block" onClick={() => void save()}>
          記録する
        </button>
      </div>

      {history.length > 0 && (
        <div className="card">
          <h2 className="sec">これまでの記録</h2>
          {history.map((h) => (
            <div className="list-item" key={h.id}>
              <div className="grow">
                <div className="row-tight">
                  <span className="pill">{h.questions.sitting_code}</span>
                  <span className="pill">問{h.questions.number}</span>
                  {h.self_score != null && <span className="pill">{h.self_score}点</span>}
                  {h.elapsed_ms != null && <span className="pill">{mmss(h.elapsed_ms)}</span>}
                </div>
                <div className="mute2 clip2" style={{ marginTop: 4 }}>
                  {h.answer_text}
                </div>
                <div className="mute2">{fmtDateTime(h.attempted_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
