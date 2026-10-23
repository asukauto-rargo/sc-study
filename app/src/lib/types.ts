export type CardState = 'new' | 'learning' | 'review' | 'relearning';
export type CardOrigin = 'manual' | 'material' | 'question';
export type Section = 'a1' | 'a2' | 'b';

export interface Card {
  id: string;
  user_id: string;
  deck: string;
  front: string;
  back: string;
  note: string | null;
  tags: string[];
  origin: CardOrigin;
  origin_ref: string | null;
  suspended: boolean;
  state: CardState;
  due: string;
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExamSitting {
  code: string;
  label: string;
  year_ad: number;
  season: 'haru' | 'aki' | 'toku';
  sort_key: number;
  ipa_urls: Record<string, string>;
  siken_base: string | null;
}

export interface Question {
  id: string;
  sitting_code: string;
  section: Section;
  number: number;
  sub_label: string | null;
  body: string;
  choices: Record<string, string> | null;
  correct: string | null;
  official_answer: string | null;
  explanation: string | null;
  topic: string | null;
  siken_url: string | null;
  attribution: string;
}

export interface QuestionAttempt {
  id: number;
  question_id: string;
  selected: string | null;
  answer_text: string | null;
  self_score: number | null;
  correct: boolean | null;
  elapsed_ms: number | null;
  attempted_at: string;
}

export interface DeckStat {
  deck: string;
  total: number;
  due: number;
  new: number;
  avg_interval: number;
}

export interface DashboardStats {
  cards: {
    total: number;
    due_now: number;
    new_cards: number;
    mature: number;
    avg_ease: number;
    avg_interval: number;
  };
  reviews: { today: number; last7: number; last30: number; retention30: number };
  by_deck: DeckStat[];
  forecast: { date: string; count: number }[];
  daily: { date: string; count: number }[];
  streak: number;
  attempts: { attempts: number; correct_n: number; accuracy: number; last7: number };
  qbank: Partial<Record<Section, number>>;
}

export const RATING_LABELS: { value: 1 | 2 | 3 | 4; label: string; hint: string; cls: string }[] = [
  { value: 1, label: 'もう一度', hint: '10分後', cls: 'again' },
  { value: 2, label: '難しい', hint: '短め', cls: 'hard' },
  { value: 3, label: 'できた', hint: '標準', cls: 'good' },
  { value: 4, label: '簡単', hint: '長め', cls: 'easy' },
];

export const SECTION_LABELS: Record<Section, string> = {
  a1: '科目A-1（旧 午前Ⅰ）',
  a2: '科目A-2（旧 午前Ⅱ）',
  b: '科目B（旧 午後・記述）',
};
