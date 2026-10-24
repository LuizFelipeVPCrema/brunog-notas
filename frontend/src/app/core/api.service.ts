import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AssessmentInput,
  Assessment,
  Board,
  GradeChange,
  GradeInput,
  ImportSummary,
  SchoolClass,
  Student,
  StudentHistory,
  Term,
  User,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  login(username: string, password: string) {
    return this.http.post<{ token: string; expiresAt: string; user: User }>('/api/auth/login', {
      username,
      password,
    });
  }

  changePassword(current: string, next: string) {
    return this.http.post<void>('/api/auth/password', { current, new: next });
  }

  users() {
    return this.http.get<User[]>('/api/users');
  }

  resetPassword(userId: number, password: string) {
    return this.http.post<void>(`/api/users/${userId}/password`, { password });
  }

  terms() {
    return this.http.get<Term[]>('/api/terms');
  }

  createTerm(year: number, number: number) {
    return this.http.post<Term>('/api/terms', { year, number });
  }

  updateTerm(id: number, year: number, number: number) {
    return this.http.patch<void>(`/api/terms/${id}`, { year, number });
  }

  deleteTerm(id: number) {
    return this.http.delete<void>(`/api/terms/${id}`);
  }

  classes(termId?: number) {
    const params: Record<string, number> = termId ? { termId } : {};
    return this.http.get<SchoolClass[]>('/api/classes', { params });
  }

  createClass(name: string) {
    return this.http.post<SchoolClass>('/api/classes', { name });
  }

  renameClass(id: number, name: string) {
    return this.http.patch<void>(`/api/classes/${id}`, { name });
  }

  board(classId: number, termId: number): Observable<Board> {
    return this.http.get<Board>(`/api/classes/${classId}/board`, { params: { termId } });
  }

  overview(termId: number) {
    return this.http.get<Board[]>('/api/overview', { params: { termId } });
  }

  searchStudents(q: string) {
    return this.http.get<Student[]>('/api/students', { params: { q } });
  }

  addStudent(name: string, classId: number, termId: number) {
    return this.http.post<Student>('/api/students', { name, classId, termId });
  }

  renameStudent(id: number, name: string) {
    return this.http.patch<void>(`/api/students/${id}`, { name });
  }

  setSituation(id: number, termId: number, situation: string | null) {
    return this.http.patch<void>(`/api/students/${id}`, { termId, situation, setSituation: true });
  }

  unenroll(id: number, termId: number) {
    return this.http.delete<void>(`/api/students/${id}/terms/${termId}`);
  }

  studentHistory(id: number) {
    return this.http.get<StudentHistory>(`/api/students/${id}/history`);
  }

  gradeChanges(id: number) {
    return this.http.get<GradeChange[]>(`/api/students/${id}/changes`);
  }

  createAssessment(input: AssessmentInput) {
    return this.http.post<Assessment>('/api/assessments', input);
  }

  updateAssessment(id: number, input: AssessmentInput) {
    return this.http.put<void>(`/api/assessments/${id}`, input);
  }

  deleteAssessment(id: number) {
    return this.http.delete<void>(`/api/assessments/${id}`);
  }

  saveGrades(grades: GradeInput[]) {
    return this.http.put<void>('/api/grades', grades);
  }

  importSheet(file: File, year: number, number: number) {
    const form = new FormData();
    form.append('file', file);
    form.append('year', String(year));
    form.append('number', String(number));
    return this.http.post<ImportSummary>('/api/import', form);
  }
}

/** Extrai a mensagem de erro devolvida pela API. */
export function apiError(err: unknown): string {
  const e = err as { error?: { error?: string }; status?: number };
  if (e?.error?.error) return e.error.error;
  if (e?.status === 0) return 'Não foi possível falar com o servidor.';
  return 'Algo deu errado. Tente novamente.';
}
