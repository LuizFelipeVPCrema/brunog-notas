import { Assessment, Board, BoardStudent, Grade } from './models';

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Alunos que entram no ranking e nas estatísticas (sem atestado/situação especial). */
export function ranked(students: BoardStudent[]): BoardStudent[] {
  return students.filter((s) => s.rank !== null);
}

/** Como uma célula de nota deve ser apresentada. */
export type CellTone = 'full' | 'good' | 'partial' | 'zero' | 'absent' | 'missing' | 'excused' | 'bonus' | 'none';

export interface CellView {
  tone: CellTone;
  label: string;
  /** Texto curto para leitores de tela / tooltip. */
  title: string;
  /** Pontos perdidos nessa avaliação (0 para bônus ou sem valor máximo). */
  lost: number;
  score: number;
}

export function fmt(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '–';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: 2 });
}

export function cellView(a: Assessment, g: Grade | undefined | null): CellView {
  const max = a.kind === 'bonus' ? null : a.maxPoints;
  if (a.kind === 'bonus' && g?.status === 'missing') g = null;
  if (!g) {
    return a.kind === 'bonus'
      ? { tone: 'none', label: '', title: `${a.name}: não se aplica`, lost: 0, score: 0 }
      : { tone: 'missing', label: 'Sem nota', title: `${a.name}: sem nota`, lost: max ?? 0, score: 0 };
  }
  switch (g.status) {
    case 'absent':
      return { tone: 'absent', label: 'Não fez', title: `${a.name}: não fez`, lost: max ?? 0, score: 0 };
    case 'excused':
      return { tone: 'excused', label: 'Atestado', title: `${a.name}: atestado`, lost: 0, score: 0 };
    case 'missing':
      return { tone: 'missing', label: 'Sem nota', title: `${a.name}: sem nota`, lost: max ?? 0, score: 0 };
  }
  const score = g.score ?? 0;
  if (a.kind === 'bonus') {
    return { tone: 'bonus', label: `+${fmt(score)}`, title: `${a.name}: +${fmt(score)} extra`, lost: 0, score };
  }
  const lost = max ? Math.max(0, max - score) : 0;
  let tone: CellTone = 'partial';
  if (score <= 0) tone = 'zero';
  else if (max && score >= max - 0.001) tone = 'full';
  else if (max && score / max >= 0.7) tone = 'good';
  const of = max ? ` de ${fmt(max)}` : '';
  return { tone, label: fmt(score), title: `${a.name}: ${fmt(score)}${of}`, lost, score };
}

export interface AssessmentStats {
  assessment: Assessment;
  average: number;
  /** Média como % do valor máximo (null quando não há máximo). */
  averagePct: number | null;
  full: number;
  partial: number;
  zero: number;
  absent: number;
  missing: number;
  /** % de alunos que entregaram/fizeram (nota lançada). */
  deliveryPct: number;
}

export function assessmentStats(board: Board): AssessmentStats[] {
  const students = ranked(board.students);
  return board.assessments.map((a) => {
    const views = students.map((s) => cellView(a, s.grades[a.id]));
    const scores = views.filter((v) => ['full', 'good', 'partial', 'zero', 'bonus'].includes(v.tone));
    const average = a.kind === 'bonus' ? mean(views.map((v) => v.score)) : mean(scores.map((v) => v.score));
    const count = (...tones: CellTone[]) => views.filter((v) => tones.includes(v.tone)).length;
    return {
      assessment: a,
      average,
      averagePct: a.maxPoints && a.kind !== 'bonus' ? (average / a.maxPoints) * 100 : null,
      full: count('full'),
      partial: count('good', 'partial'),
      zero: count('zero'),
      absent: count('absent'),
      missing: count('missing'),
      deliveryPct: students.length
        ? (views.filter((v) => !['absent', 'missing', 'zero'].includes(v.tone)).length / students.length) * 100
        : 0,
    };
  });
}

export interface ClassStats {
  count: number;
  average: number;
  median: number;
  stdev: number;
  best: number;
  worst: number;
  passing: number;
  passingPct: number;
  examAverage: number | null;
  /** Alunos com ao menos uma avaliação não feita. */
  withPending: number;
}

export function classStats(board: Board, passingGrade: number): ClassStats {
  const students = ranked(board.students);
  const totals = students.map((s) => s.total);
  const exams = students.filter((s) => s.teacherExam !== null).map((s) => s.teacherExam as number);
  const passing = totals.filter((t) => t >= passingGrade).length;
  const withPending = students.filter((s) =>
    board.assessments.some((a) => ['absent', 'missing'].includes(cellView(a, s.grades[a.id]).tone)),
  ).length;
  return {
    count: students.length,
    average: mean(totals),
    median: median(totals),
    stdev: stdev(totals),
    best: totals.length ? Math.max(...totals) : 0,
    worst: totals.length ? Math.min(...totals) : 0,
    passing,
    passingPct: totals.length ? (passing / totals.length) * 100 : 0,
    examAverage: exams.length ? mean(exams) : null,
    withPending,
  };
}

/** Distribuição das notas finais em faixas de 1 ponto (0–1, 1–2, ..., 9–10). */
export function histogram(values: number[], max: number): number[] {
  const bins = new Array(Math.ceil(max)).fill(0);
  for (const v of values) bins[Math.min(bins.length - 1, Math.max(0, Math.floor(v)))]++;
  return bins;
}

/** Max points of the teacher's exam(s) on a board (sum when there is more than one). */
export function examMax(assessments: Assessment[]): number {
  return assessments
    .filter((a) => a.kind === 'exam_teacher')
    .reduce((sum, a) => sum + (a.maxPoints ?? 0), 0);
}
