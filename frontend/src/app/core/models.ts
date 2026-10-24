export type Role = 'admin' | 'teacher';

export interface User {
  id: number;
  username: string;
  name: string;
  role: Role;
}

export interface Term {
  id: number;
  year: number;
  number: number;
}

export interface SchoolClass {
  id: number;
  name: string;
}

export type AssessmentKind = 'activity' | 'notebook' | 'exam_external' | 'exam_teacher' | 'bonus';
export type GradeStatus = 'graded' | 'absent' | 'excused' | 'missing';

export interface Assessment {
  id: number;
  name: string;
  kind: AssessmentKind;
  maxPoints: number | null;
  position: number;
}

export interface Grade {
  score: number | null;
  status: GradeStatus;
  note?: string | null;
}

export interface BoardStudent {
  id: number;
  name: string;
  situation: string | null;
  grades: Record<string, Grade>;
  total: number;
  teacherExam: number | null;
  rank: number | null;
  examRank: number | null;
}

export interface Board {
  class: SchoolClass;
  term: Term;
  maxTotal: number;
  assessments: Assessment[];
  students: BoardStudent[];
}

export interface Student {
  id: number;
  name: string;
}

export interface Breakdown {
  assessment: Assessment;
  grade: Grade | null;
}

export interface TermResult {
  term: Term;
  class: SchoolClass;
  situation: string | null;
  total: number;
  teacherExam: number | null;
  rank: number | null;
  examRank: number | null;
  classSize: number;
  rankedCount: number;
  classAverage: number;
  classBest: number;
  breakdown: Breakdown[];
}

export interface StudentHistory {
  student: Student;
  maxTotal: number;
  terms: TermResult[];
}

export interface GradeChange {
  id: number;
  term: Term;
  class: string;
  assessment: string;
  oldScore: number | null;
  oldStatus: GradeStatus | null;
  newScore: number | null;
  newStatus: GradeStatus;
  source: 'manual' | 'import';
  changedBy: string | null;
  changedAt: string;
}

export interface GradeInput {
  assessmentId: number;
  studentId: number;
  score: number | null;
  status: GradeStatus;
  note?: string | null;
}

export interface AssessmentInput {
  classId: number;
  termId: number;
  name: string;
  kind: AssessmentKind;
  maxPoints: number | null;
  position?: number | null;
}

export interface ImportSummary {
  term: Term;
  students: number;
  newStudents: number;
  gradesChanged: number;
  classes: { name: string; students: number; assessments: string[]; warnings: string[] }[];
}

export const KIND_LABELS: Record<AssessmentKind, string> = {
  activity: 'Atividade',
  notebook: 'Caderno',
  exam_external: 'Prova externa',
  exam_teacher: 'Prova do professor',
  bonus: 'Bônus / extra',
};

export function termLabel(t: Term | null | undefined): string {
  return t ? `${t.number}º Bim. ${t.year}` : '';
}
