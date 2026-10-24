// Package store concentra o acesso ao Postgres e as regras de cálculo
// (total do aluno, rankings).
package store

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"brunog.lfvpc.cloud/notas/internal/auth"
	"brunog.lfvpc.cloud/notas/internal/importer"
	"brunog.lfvpc.cloud/notas/internal/textutil"
)

var (
	ErrNotFound = errors.New("não encontrado")
	ErrConflict = errors.New("já existe")
)

type Store struct {
	pool     *pgxpool.Pool
	maxTotal float64
}

func New(pool *pgxpool.Pool, maxTotal float64) *Store {
	return &Store{pool: pool, maxTotal: maxTotal}
}

func (s *Store) MaxTotal() float64 { return s.maxTotal }

// ---------- usuários ----------

// EnsureUser cria o usuário se ele ainda não existir. Usuários existentes não
// são alterados, para que uma troca de senha feita pelo sistema persista.
func (s *Store) EnsureUser(ctx context.Context, username, name, role, password string) error {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE lower(username) = lower($1))`, username).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO users (username, display_name, role, password_hash) VALUES ($1, $2, $3, $4)`,
		username, name, role, hash)
	return err
}

// UserByUsername busca ignorando maiúsculas/minúsculas no login.
func (s *Store) UserByUsername(ctx context.Context, username string) (auth.User, string, error) {
	var u auth.User
	var hash string
	err := s.pool.QueryRow(ctx, `SELECT id, username, display_name, role, password_hash FROM users WHERE lower(username) = lower($1)`, username).
		Scan(&u.ID, &u.Username, &u.Name, &u.Role, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, "", ErrNotFound
	}
	return u, hash, err
}

func (s *Store) UserByID(ctx context.Context, id int64) (auth.User, string, error) {
	var u auth.User
	var hash string
	err := s.pool.QueryRow(ctx, `SELECT id, username, display_name, role, password_hash FROM users WHERE id = $1`, id).
		Scan(&u.ID, &u.Username, &u.Name, &u.Role, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, "", ErrNotFound
	}
	return u, hash, err
}

func (s *Store) ListUsers(ctx context.Context) ([]auth.User, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, username, display_name, role FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (auth.User, error) {
		var u auth.User
		err := r.Scan(&u.ID, &u.Username, &u.Name, &u.Role)
		return u, err
	})
}

func (s *Store) SetPassword(ctx context.Context, userID int64, password string) error {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, userID, hash)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// ---------- bimestres e turmas ----------

type Term struct {
	ID     int64 `json:"id"`
	Year   int   `json:"year"`
	Number int   `json:"number"`
}

func (t Term) Label() string { return fmt.Sprintf("%dº Bimestre %d", t.Number, t.Year) }

func (s *Store) ListTerms(ctx context.Context) ([]Term, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, year, number FROM terms ORDER BY year, number`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Term])
}

func (s *Store) EnsureTerm(ctx context.Context, year, number int) (Term, error) {
	t := Term{Year: year, Number: number}
	err := s.pool.QueryRow(ctx, `INSERT INTO terms (year, number) VALUES ($1, $2)
		ON CONFLICT (year, number) DO UPDATE SET year = EXCLUDED.year RETURNING id`, year, number).Scan(&t.ID)
	return t, err
}

// UpdateTerm corrige o ano/número de um bimestre (ex.: importado no bimestre errado).
func (s *Store) UpdateTerm(ctx context.Context, id int64, year, number int) error {
	return mapErr(execOne(s.pool.Exec(ctx, `UPDATE terms SET year = $2, number = $3 WHERE id = $1`, id, year, number)))
}

func (s *Store) DeleteTerm(ctx context.Context, id int64) error {
	return execOne(s.pool.Exec(ctx, `DELETE FROM terms WHERE id = $1`, id))
}

func (s *Store) term(ctx context.Context, id int64) (Term, error) {
	t := Term{ID: id}
	err := s.pool.QueryRow(ctx, `SELECT year, number FROM terms WHERE id = $1`, id).Scan(&t.Year, &t.Number)
	if errors.Is(err, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	return t, err
}

type Class struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// ClassesInTerm lista as turmas que têm alunos no bimestre.
func (s *Store) ClassesInTerm(ctx context.Context, termID int64) ([]Class, error) {
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT c.id, c.name FROM classes c
		JOIN enrollments e ON e.class_id = c.id WHERE e.term_id = $1 ORDER BY c.name`, termID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Class])
}

func (s *Store) ListClasses(ctx context.Context) ([]Class, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name FROM classes ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Class])
}

func (s *Store) CreateClass(ctx context.Context, name string) (Class, error) {
	c := Class{Name: textutil.CleanName(name)}
	err := s.pool.QueryRow(ctx, `INSERT INTO classes (name) VALUES ($1) RETURNING id`, c.Name).Scan(&c.ID)
	return c, mapErr(err)
}

func (s *Store) RenameClass(ctx context.Context, id int64, name string) error {
	return mapErr(execOne(s.pool.Exec(ctx, `UPDATE classes SET name = $2 WHERE id = $1`, id, textutil.CleanName(name))))
}

func (s *Store) class(ctx context.Context, id int64) (Class, error) {
	c := Class{ID: id}
	err := s.pool.QueryRow(ctx, `SELECT name FROM classes WHERE id = $1`, id).Scan(&c.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

// ---------- quadro de notas de uma turma ----------

type Assessment struct {
	ID        int64    `json:"id"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	MaxPoints *float64 `json:"maxPoints"`
	Position  int      `json:"position"`
}

type Grade struct {
	Score  *float64 `json:"score"`
	Status string   `json:"status"`
	Note   *string  `json:"note,omitempty"`
}

type BoardStudent struct {
	ID          int64            `json:"id"`
	Name        string           `json:"name"`
	Situation   *string          `json:"situation"`
	Grades      map[string]Grade `json:"grades"`
	Total       float64          `json:"total"`
	TeacherExam *float64         `json:"teacherExam"`
	Rank        *int             `json:"rank"`
	ExamRank    *int             `json:"examRank"`
}

type Board struct {
	Class       Class          `json:"class"`
	Term        Term           `json:"term"`
	MaxTotal    float64        `json:"maxTotal"`
	Assessments []Assessment   `json:"assessments"`
	Students    []BoardStudent `json:"students"`
}

func (s *Store) Board(ctx context.Context, classID, termID int64) (*Board, error) {
	class, err := s.class(ctx, classID)
	if err != nil {
		return nil, err
	}
	term, err := s.term(ctx, termID)
	if err != nil {
		return nil, err
	}
	b := &Board{Class: class, Term: term, MaxTotal: s.maxTotal, Assessments: []Assessment{}, Students: []BoardStudent{}}

	rows, err := s.pool.Query(ctx, `SELECT id, name, kind, max_points::float8, position FROM assessments
		WHERE class_id = $1 AND term_id = $2 ORDER BY position, id`, classID, termID)
	if err != nil {
		return nil, err
	}
	if b.Assessments, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Assessment]); err != nil {
		return nil, err
	}
	kinds := map[string]string{}
	for _, a := range b.Assessments {
		kinds[fmt.Sprint(a.ID)] = a.Kind
	}

	rows, err = s.pool.Query(ctx, `SELECT s.id, s.name, e.situation FROM enrollments e
		JOIN students s ON s.id = e.student_id
		WHERE e.class_id = $1 AND e.term_id = $2 ORDER BY s.normalized_name`, classID, termID)
	if err != nil {
		return nil, err
	}
	index := map[int64]int{}
	for rows.Next() {
		var st BoardStudent
		if err := rows.Scan(&st.ID, &st.Name, &st.Situation); err != nil {
			return nil, err
		}
		st.Grades = map[string]Grade{}
		index[st.ID] = len(b.Students)
		b.Students = append(b.Students, st)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = s.pool.Query(ctx, `SELECT g.student_id, g.assessment_id, g.score::float8, g.status, g.note
		FROM grades g JOIN assessments a ON a.id = g.assessment_id
		WHERE a.class_id = $1 AND a.term_id = $2`, classID, termID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var studentID, assessmentID int64
		var g Grade
		if err := rows.Scan(&studentID, &assessmentID, &g.Score, &g.Status, &g.Note); err != nil {
			return nil, err
		}
		if i, ok := index[studentID]; ok {
			b.Students[i].Grades[fmt.Sprint(assessmentID)] = g
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range b.Students {
		st := &b.Students[i]
		var total, exam float64
		hasExam := false
		for key, g := range st.Grades {
			if g.Status != importer.StatusGraded || g.Score == nil {
				continue
			}
			total += *g.Score
			if kinds[key] == importer.KindExamTeacher {
				exam += *g.Score
				hasExam = true
			}
		}
		st.Total = round2(math.Min(total, s.maxTotal))
		if hasExam {
			e := round2(exam)
			st.TeacherExam = &e
		}
	}
	rank(b.Students, func(st *BoardStudent) (float64, bool) {
		return st.Total, st.Situation == nil
	}, func(st *BoardStudent, r int) { st.Rank = &r })
	rank(b.Students, func(st *BoardStudent) (float64, bool) {
		if st.TeacherExam == nil || st.Situation != nil {
			return 0, false
		}
		return *st.TeacherExam, true
	}, func(st *BoardStudent, r int) { st.ExamRank = &r })
	return b, nil
}

// rank aplica ranking de competição (1, 2, 2, 4) aos alunos elegíveis.
func rank(students []BoardStudent, value func(*BoardStudent) (float64, bool), set func(*BoardStudent, int)) {
	type item struct {
		i int
		v float64
	}
	var items []item
	for i := range students {
		if v, ok := value(&students[i]); ok {
			items = append(items, item{i, v})
		}
	}
	sort.SliceStable(items, func(a, b int) bool { return items[a].v > items[b].v })
	prev := 0
	for pos, it := range items {
		r := pos + 1
		if pos > 0 && math.Abs(items[pos-1].v-it.v) < 0.001 {
			r = prev
		}
		prev = r
		set(&students[it.i], r)
	}
}

// ---------- alunos ----------

type Student struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

func (s *Store) SearchStudents(ctx context.Context, q string) ([]Student, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name FROM students WHERE normalized_name LIKE '%' || $1 || '%'
		ORDER BY normalized_name LIMIT 30`, textutil.NormalizeName(q))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Student])
}

// AddStudent cria (ou reaproveita, pelo nome normalizado) o aluno e o matricula
// na turma/bimestre.
func (s *Store) AddStudent(ctx context.Context, name string, classID, termID int64) (Student, error) {
	st := Student{Name: textutil.CleanName(name)}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return st, err
	}
	defer tx.Rollback(ctx)
	if st.ID, err = upsertStudent(ctx, tx, st.Name); err != nil {
		return st, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO enrollments (student_id, term_id, class_id) VALUES ($1, $2, $3)
		ON CONFLICT (student_id, term_id) DO UPDATE SET class_id = EXCLUDED.class_id`, st.ID, termID, classID); err != nil {
		return st, mapErr(err)
	}
	return st, tx.Commit(ctx)
}

func (s *Store) RenameStudent(ctx context.Context, id int64, name string) error {
	name = textutil.CleanName(name)
	return mapErr(execOne(s.pool.Exec(ctx, `UPDATE students SET name = $2, normalized_name = $3 WHERE id = $1`,
		id, name, textutil.NormalizeName(name))))
}

func (s *Store) SetSituation(ctx context.Context, studentID, termID int64, situation *string) error {
	return execOne(s.pool.Exec(ctx, `UPDATE enrollments SET situation = NULLIF(trim($3), '') WHERE student_id = $1 AND term_id = $2`,
		studentID, termID, situation))
}

// Unenroll tira o aluno do bimestre (as notas daquela turma/bimestre são apagadas).
func (s *Store) Unenroll(ctx context.Context, studentID, termID int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM grades g USING assessments a
		WHERE g.assessment_id = a.id AND a.term_id = $2 AND g.student_id = $1`, studentID, termID); err != nil {
		return err
	}
	if err := execOne(tx.Exec(ctx, `DELETE FROM enrollments WHERE student_id = $1 AND term_id = $2`, studentID, termID)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM students s WHERE s.id = $1
		AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id)`, studentID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ---------- histórico do aluno entre bimestres ----------

type Breakdown struct {
	Assessment Assessment `json:"assessment"`
	Grade      *Grade     `json:"grade"`
}

type TermResult struct {
	Term         Term        `json:"term"`
	Class        Class       `json:"class"`
	Situation    *string     `json:"situation"`
	Total        float64     `json:"total"`
	TeacherExam  *float64    `json:"teacherExam"`
	Rank         *int        `json:"rank"`
	ExamRank     *int        `json:"examRank"`
	ClassSize    int         `json:"classSize"`
	RankedCount  int         `json:"rankedCount"`
	ClassAverage float64     `json:"classAverage"`
	ClassBest    float64     `json:"classBest"`
	Breakdown    []Breakdown `json:"breakdown"`
}

type StudentHistory struct {
	Student  Student      `json:"student"`
	MaxTotal float64      `json:"maxTotal"`
	Terms    []TermResult `json:"terms"`
}

func (s *Store) StudentHistory(ctx context.Context, studentID int64) (*StudentHistory, error) {
	h := &StudentHistory{Student: Student{ID: studentID}, MaxTotal: s.maxTotal, Terms: []TermResult{}}
	err := s.pool.QueryRow(ctx, `SELECT name FROM students WHERE id = $1`, studentID).Scan(&h.Student.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT e.class_id, e.term_id FROM enrollments e JOIN terms t ON t.id = e.term_id
		WHERE e.student_id = $1 ORDER BY t.year, t.number`, studentID)
	if err != nil {
		return nil, err
	}
	type pair struct{ Class, Term int64 }
	pairs, err := pgx.CollectRows(rows, pgx.RowToStructByPos[pair])
	if err != nil {
		return nil, err
	}
	for _, p := range pairs {
		b, err := s.Board(ctx, p.Class, p.Term)
		if err != nil {
			return nil, err
		}
		r := TermResult{Term: b.Term, Class: b.Class, ClassSize: len(b.Students), Breakdown: []Breakdown{}}
		var sum float64
		for _, st := range b.Students {
			if st.Rank != nil {
				r.RankedCount++
				sum += st.Total
				r.ClassBest = math.Max(r.ClassBest, st.Total)
			}
			if st.ID != studentID {
				continue
			}
			r.Situation, r.Total, r.TeacherExam, r.Rank, r.ExamRank = st.Situation, st.Total, st.TeacherExam, st.Rank, st.ExamRank
			for _, a := range b.Assessments {
				bd := Breakdown{Assessment: a}
				if g, ok := st.Grades[fmt.Sprint(a.ID)]; ok {
					bd.Grade = &g
				}
				r.Breakdown = append(r.Breakdown, bd)
			}
		}
		if r.RankedCount > 0 {
			r.ClassAverage = round2(sum / float64(r.RankedCount))
		}
		h.Terms = append(h.Terms, r)
	}
	return h, nil
}

// ---------- avaliações ----------

type AssessmentInput struct {
	ClassID   int64    `json:"classId"`
	TermID    int64    `json:"termId"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	MaxPoints *float64 `json:"maxPoints"`
	Position  *int     `json:"position"`
}

func (s *Store) CreateAssessment(ctx context.Context, in AssessmentInput) (Assessment, error) {
	a := Assessment{Name: textutil.CleanName(in.Name), Kind: in.Kind, MaxPoints: in.MaxPoints}
	err := s.pool.QueryRow(ctx, `INSERT INTO assessments (class_id, term_id, name, kind, max_points, position)
		VALUES ($1, $2, $3, $4, $5, COALESCE($6, (SELECT COALESCE(max(position) + 1, 0) FROM assessments WHERE class_id = $1 AND term_id = $2)))
		RETURNING id, position`, in.ClassID, in.TermID, a.Name, a.Kind, a.MaxPoints, in.Position).Scan(&a.ID, &a.Position)
	return a, mapErr(err)
}

func (s *Store) UpdateAssessment(ctx context.Context, id int64, in AssessmentInput) error {
	return mapErr(execOne(s.pool.Exec(ctx, `UPDATE assessments SET name = $2, kind = $3, max_points = $4,
		position = COALESCE($5, position) WHERE id = $1`, id, textutil.CleanName(in.Name), in.Kind, in.MaxPoints, in.Position)))
}

func (s *Store) DeleteAssessment(ctx context.Context, id int64) error {
	return execOne(s.pool.Exec(ctx, `DELETE FROM assessments WHERE id = $1`, id))
}

// ---------- notas ----------

type GradeInput struct {
	AssessmentID int64    `json:"assessmentId"`
	StudentID    int64    `json:"studentId"`
	Score        *float64 `json:"score"`
	Status       string   `json:"status"`
	Note         *string  `json:"note"`
}

type queryer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// SaveGrades grava várias notas numa transação, registrando o histórico.
func (s *Store) SaveGrades(ctx context.Context, userID int64, inputs []GradeInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, in := range inputs {
		if _, err := saveGrade(ctx, tx, userID, in, "manual"); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// saveGrade faz o upsert de uma nota e grava no histórico se algo mudou.
func saveGrade(ctx context.Context, q queryer, userID int64, in GradeInput, source string) (bool, error) {
	if in.Status != importer.StatusGraded {
		in.Score = nil
	}
	var oldScore *float64
	var oldStatus *string
	err := q.QueryRow(ctx, `SELECT score::float8, status FROM grades WHERE assessment_id = $1 AND student_id = $2`,
		in.AssessmentID, in.StudentID).Scan(&oldScore, &oldStatus)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	changed := oldStatus == nil || *oldStatus != in.Status || !sameScore(oldScore, in.Score)
	_, err = q.Exec(ctx, `INSERT INTO grades (assessment_id, student_id, score, status, note, updated_by)
		VALUES ($1, $2, $3, $4, NULLIF(trim($5), ''), $6)
		ON CONFLICT (assessment_id, student_id) DO UPDATE SET score = EXCLUDED.score, status = EXCLUDED.status,
			note = EXCLUDED.note,
			updated_at = CASE WHEN $7 THEN now() ELSE grades.updated_at END,
			updated_by = CASE WHEN $7 THEN EXCLUDED.updated_by ELSE grades.updated_by END`,
		in.AssessmentID, in.StudentID, in.Score, in.Status, in.Note, nullID(userID), changed)
	if err != nil {
		return false, mapErr(err)
	}
	if changed {
		_, err = q.Exec(ctx, `INSERT INTO grade_history (assessment_id, student_id, old_score, old_status, new_score, new_status, source, changed_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			in.AssessmentID, in.StudentID, oldScore, oldStatus, in.Score, in.Status, source, nullID(userID))
	}
	return changed, err
}

type HistoryEntry struct {
	ID         int64    `json:"id"`
	Term       Term     `json:"term"`
	Class      string   `json:"class"`
	Assessment string   `json:"assessment"`
	OldScore   *float64 `json:"oldScore"`
	OldStatus  *string  `json:"oldStatus"`
	NewScore   *float64 `json:"newScore"`
	NewStatus  string   `json:"newStatus"`
	Source     string   `json:"source"`
	ChangedBy  *string  `json:"changedBy"`
	ChangedAt  string   `json:"changedAt"`
}

func (s *Store) GradeHistory(ctx context.Context, studentID int64) ([]HistoryEntry, error) {
	rows, err := s.pool.Query(ctx, `SELECT h.id, t.id, t.year, t.number, c.name, a.name,
			h.old_score::float8, h.old_status, h.new_score::float8, h.new_status, h.source, u.display_name,
			to_char(h.changed_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
		FROM grade_history h
		JOIN assessments a ON a.id = h.assessment_id
		JOIN classes c ON c.id = a.class_id
		JOIN terms t ON t.id = a.term_id
		LEFT JOIN users u ON u.id = h.changed_by
		WHERE h.student_id = $1 ORDER BY h.changed_at DESC, h.id DESC LIMIT 300`, studentID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (HistoryEntry, error) {
		var e HistoryEntry
		err := r.Scan(&e.ID, &e.Term.ID, &e.Term.Year, &e.Term.Number, &e.Class, &e.Assessment,
			&e.OldScore, &e.OldStatus, &e.NewScore, &e.NewStatus, &e.Source, &e.ChangedBy, &e.ChangedAt)
		return e, err
	})
}

// ---------- importação ----------

type ImportSummary struct {
	Term          Term          `json:"term"`
	Classes       []ClassImport `json:"classes"`
	Students      int           `json:"students"`
	NewStudents   int           `json:"newStudents"`
	GradesChanged int           `json:"gradesChanged"`
}

type ClassImport struct {
	Name        string   `json:"name"`
	Students    int      `json:"students"`
	Assessments []string `json:"assessments"`
	Warnings    []string `json:"warnings"`
}

// Import grava as abas da planilha no bimestre informado. Reimportar a mesma
// planilha é seguro: notas iguais não geram histórico, notas diferentes sim.
func (s *Store) Import(ctx context.Context, userID int64, year, number int, filename string, sheets []importer.Sheet) (*ImportSummary, error) {
	term, err := s.EnsureTerm(ctx, year, number)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	sum := &ImportSummary{Term: term, Classes: []ClassImport{}}
	for _, sh := range sheets {
		var classID int64
		if err := tx.QueryRow(ctx, `INSERT INTO classes (name) VALUES ($1)
			ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, sh.ClassName).Scan(&classID); err != nil {
			return nil, err
		}
		ci := ClassImport{Name: sh.ClassName, Students: len(sh.Students), Assessments: []string{}, Warnings: sh.Warnings}
		if ci.Warnings == nil {
			ci.Warnings = []string{}
		}

		assessmentIDs := make([]int64, len(sh.Assessments))
		for i, a := range sh.Assessments {
			// Mantém tipo/peso editados no sistema; só cria se não existir.
			if err := tx.QueryRow(ctx, `INSERT INTO assessments (class_id, term_id, name, kind, max_points, position)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (class_id, term_id, name) DO UPDATE SET position = EXCLUDED.position RETURNING id`,
				classID, term.ID, a.Name, a.Kind, a.MaxPoints, a.Position).Scan(&assessmentIDs[i]); err != nil {
				return nil, err
			}
			ci.Assessments = append(ci.Assessments, a.Name)
		}

		for _, st := range sh.Students {
			var existed bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM students WHERE normalized_name = $1)`,
				textutil.NormalizeName(st.Name)).Scan(&existed); err != nil {
				return nil, err
			}
			studentID, err := upsertStudent(ctx, tx, st.Name)
			if err != nil {
				return nil, err
			}
			if !existed {
				sum.NewStudents++
			}
			sum.Students++
			var situation *string
			if st.Situation != "" {
				situation = &st.Situation
			}
			if _, err := tx.Exec(ctx, `INSERT INTO enrollments (student_id, term_id, class_id, situation) VALUES ($1, $2, $3, $4)
				ON CONFLICT (student_id, term_id) DO UPDATE SET class_id = EXCLUDED.class_id, situation = EXCLUDED.situation`,
				studentID, term.ID, classID, situation); err != nil {
				return nil, err
			}
			for i, c := range st.Cells {
				if c == nil {
					continue
				}
				var note *string
				if c.Note != "" {
					note = &c.Note
				}
				changed, err := saveGrade(ctx, tx, userID, GradeInput{
					AssessmentID: assessmentIDs[i], StudentID: studentID, Score: c.Score, Status: c.Status, Note: note,
				}, "import")
				if err != nil {
					return nil, err
				}
				if changed {
					sum.GradesChanged++
				}
			}
		}
		sum.Classes = append(sum.Classes, ci)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO imports (term_id, filename, summary, imported_by) VALUES ($1, $2, $3, $4)`,
		term.ID, filename, sum, nullID(userID)); err != nil {
		return nil, err
	}
	return sum, tx.Commit(ctx)
}

func upsertStudent(ctx context.Context, q queryer, name string) (int64, error) {
	var id int64
	err := q.QueryRow(ctx, `INSERT INTO students (name, normalized_name) VALUES ($1, $2)
		ON CONFLICT (normalized_name) DO UPDATE SET normalized_name = EXCLUDED.normalized_name RETURNING id`,
		textutil.CleanName(name), textutil.NormalizeName(name)).Scan(&id)
	return id, err
}

// ---------- utilitários ----------

func execOne(tag pgconn.CommandTag, err error) error {
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func mapErr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return ErrConflict
		case "23503":
			return ErrNotFound
		}
	}
	return err
}

func nullID(id int64) *int64 {
	if id == 0 {
		return nil
	}
	return &id
}

func sameScore(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return math.Abs(*a-*b) < 0.001
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }
