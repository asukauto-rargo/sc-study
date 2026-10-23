export function fmtInterval(days: number): string {
  if (days <= 0) return '10分';
  if (days < 1) return `${Math.round(days * 24)}時間`;
  if (days < 30) return `${Math.round(days)}日`;
  if (days < 365) return `${(days / 30).toFixed(1)}か月`;
  return `${(days / 365).toFixed(1)}年`;
}

export function fmtDue(iso: string): string {
  const due = new Date(iso).getTime();
  const diff = due - Date.now();
  if (diff <= 0) return '今すぐ';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}分後`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}時間後`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}日後`;
  return `${(days / 30).toFixed(1)}か月後`;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
