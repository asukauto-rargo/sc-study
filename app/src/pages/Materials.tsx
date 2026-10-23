import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Material } from '../lib/types';
import { clamp } from '../lib/format';

interface Hit {
  material_id: string;
  material_title: string;
  page: number;
  snippet: string;
  score: number;
}

/**
 * 資料タブ。
 * 購入教材のPDF本体はクラウドに置かない方針なので、ここで見るのは
 * 取り込み時に抽出したページ単位のテキスト（検索と所在の特定用）。
 * ページ番号が分かれば、手元のPDFをそのページで開ける。
 */
export default function Materials() {
  const [tab, setTab] = useState<'list' | 'search'>('list');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [open, setOpen] = useState<Material | null>(null);
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState('');
  const [loadingPage, setLoadingPage] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [draft, setDraft] = useState<{ front: string; back: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('materials')
      .select('*')
      .order('title')
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setMaterials((data ?? []) as Material[]);
      });
  }, []);

  const openMaterial = useCallback((m: Material, startPage = 1) => {
    setErr(null);
    setOpen(m);
    setTab('list');
    setPage(clamp(startPage, 1, m.page_count ?? 1));
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingPage(true);
    supabase
      .from('material_pages')
      .select('text')
      .eq('material_id', open.id)
      .eq('page', page)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setErr(error.message);
        setPageText((data as { text: string } | null)?.text ?? '');
        setLoadingPage(false);
      });
    return () => {
      active = false;
    };
  }, [open, page]);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    setErr(null);
    const { data, error } = await supabase.rpc('search_pages', { p_query: q.trim(), p_limit: 40 });
    if (error) setErr(error.message);
    else setHits((data ?? []) as Hit[]);
    setSearching(false);
  }

  async function saveCard() {
    if (!draft || !open) return;
    if (!draft.front.trim() || !draft.back.trim()) {
      setErr('表と裏の両方を入力してください。');
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('cards').insert({
      user_id: u.user!.id,
      deck: open.title,
      front: draft.front.trim(),
      back: draft.back.trim(),
      origin: 'material',
      source_material_id: open.id,
      source_page: page,
      note: `${open.title} p.${page}`,
    });
    if (error) setErr(error.message);
    else {
      setDraft(null);
      setSaved(`カードを追加しました（${open.title} p.${page}）`);
      setTimeout(() => setSaved(null), 4000);
    }
  }

  const numPages = open?.page_count ?? 1;

  return (
    <div className="stack">
      <div className="card">
        <div className="row">
          <button
            className={`btn btn-sm ${tab === 'list' ? 'btn-primary' : ''}`}
            onClick={() => setTab('list')}
          >
            資料
          </button>
          <button
            className={`btn btn-sm ${tab === 'search' ? 'btn-primary' : ''}`}
            onClick={() => setTab('search')}
          >
            全文検索
          </button>
        </div>
      </div>

      {err && <div className="alert alert-err">{err}</div>}
      {saved && <div className="alert alert-ok">{saved}</div>}

      {tab === 'search' && (
        <div className="card">
          <form className="row" onSubmit={runSearch}>
            <input
              className="grow"
              type="search"
              placeholder="例: SPF DMARC、セッション固定化、CVSS"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="btn btn-primary btn-sm" disabled={searching}>
              検索
            </button>
          </form>
          <p className="mute2" style={{ margin: '8px 0 0' }}>
            空白区切りで AND 検索。`OR` も使えます（pgroonga による日本語全文検索）。
          </p>

          {hits && (
            <div style={{ marginTop: 12 }}>
              {hits.length === 0 ? (
                <p className="mute2">ヒットなし。</p>
              ) : (
                <>
                  <p className="mute2">{hits.length}件</p>
                  {hits.map((h) => (
                    <div className="hit" key={`${h.material_id}-${h.page}`}>
                      <div className="row-tight">
                        <span className="pill">{h.material_title}</span>
                        <span className="pill">p.{h.page}</span>
                      </div>
                      <div className="snippet">{h.snippet}</div>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          const m = materials.find((x) => x.id === h.material_id);
                          if (m) openMaterial(m, h.page);
                        }}
                      >
                        このページを開く
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'list' && !open && (
        <div className="card">
          <h2 className="sec">学習資料</h2>
          {materials.length === 0 ? (
            <p className="small" style={{ margin: 0 }}>
              資料がまだありません。<code>学習資料/</code> に PDF を置いて、Mac のターミナルで
              <code> cd tools &amp;&amp; npm run ingest:materials </code>
              を実行すると、各ページのテキストが取り込まれます。
            </p>
          ) : (
            <>
              {materials.map((m) => (
                <div className="list-item" key={m.id}>
                  <div className="grow">
                    <div className="t">{m.title}</div>
                    <div className="mute2">{m.page_count ?? '?'} ページ</div>
                  </div>
                  <button className="btn btn-sm" onClick={() => openMaterial(m)}>
                    開く
                  </button>
                </div>
              ))}
              <p className="mute2" style={{ marginBottom: 0 }}>
                PDF 本体はクラウドに置いていません。ここで見られるのは検索用に抽出した
                テキストです。ページ番号を見て、手元の PDF を開いてください。
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'list' && open && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setOpen(null);
                  setDraft(null);
                }}
              >
                ← 一覧
              </button>
              <strong className="small">{open.title}</strong>
            </div>
            <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
              <button
                className="btn btn-sm"
                onClick={() => setPage((p) => clamp(p - 1, 1, numPages))}
                disabled={page <= 1}
              >
                前
              </button>
              <input
                type="number"
                className="mono"
                value={page}
                min={1}
                max={numPages}
                onChange={(e) => setPage(clamp(Number(e.target.value) || 1, 1, numPages))}
                style={{ width: 86, textAlign: 'center' }}
              />
              <span className="mute2">/ {numPages}</span>
              <button
                className="btn btn-sm"
                onClick={() => setPage((p) => clamp(p + 1, 1, numPages))}
                disabled={page >= numPages}
              >
                次
              </button>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 className="sec" style={{ margin: 0 }}>
                p.{page} のテキスト
              </h2>
              {!draft && (
                <button
                  className="btn btn-sm"
                  onClick={() => setDraft({ front: '', back: pageText.slice(0, 400) })}
                >
                  カードにする
                </button>
              )}
            </div>

            {loadingPage ? (
              <div className="row" style={{ justifyContent: 'center', padding: 16 }}>
                <div className="spinner" />
              </div>
            ) : (
              <div
                className="qbody"
                style={{ marginTop: 10, fontSize: 15, color: pageText ? undefined : 'var(--fg-mute)' }}
              >
                {pageText || '（このページにテキストはありません。図版のみのスライドの可能性があります）'}
              </div>
            )}
          </div>

          {draft && (
            <div className="card">
              <h2 className="sec">カードを作る</h2>
              <label className="field">
                <span>表（問い）— 自分の言葉で問いの形にすると定着しやすい</span>
                <textarea
                  value={draft.front}
                  onChange={(e) => setDraft({ ...draft, front: e.target.value })}
                  style={{ minHeight: 90 }}
                  autoFocus
                />
              </label>
              <label className="field">
                <span>裏（答え）</span>
                <textarea
                  value={draft.back}
                  onChange={(e) => setDraft({ ...draft, back: e.target.value })}
                  style={{ minHeight: 140 }}
                />
              </label>
              <div className="row">
                <button className="btn btn-primary" onClick={() => void saveCard()}>
                  保存
                </button>
                <button className="btn" onClick={() => setDraft(null)}>
                  キャンセル
                </button>
                <span className="mute2">分野は「{open.title}」になります</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
