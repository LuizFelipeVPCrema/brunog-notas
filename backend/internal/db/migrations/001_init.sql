CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'teacher')),
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bimestres (ex.: 3º bimestre de 2026).
CREATE TABLE terms (
    id         BIGSERIAL PRIMARY KEY,
    year       INT NOT NULL,
    number     INT NOT NULL CHECK (number BETWEEN 1 AND 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (year, number)
);

-- Turmas (uma aba da planilha).
CREATE TABLE classes (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Alunos. normalized_name (sem acento, maiúsculo) identifica o aluno entre
-- bimestres e anos, permitindo comparar a evolução mesmo trocando de turma.
CREATE TABLE students (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Em qual turma o aluno estava em cada bimestre. situation guarda casos
-- como "Atestado" (sem nota no bimestre).
CREATE TABLE enrollments (
    student_id BIGINT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    term_id    BIGINT NOT NULL REFERENCES terms (id) ON DELETE CASCADE,
    class_id   BIGINT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    situation  TEXT,
    PRIMARY KEY (student_id, term_id)
);
CREATE INDEX enrollments_class_term ON enrollments (class_id, term_id);

-- Avaliações de uma turma num bimestre (Atividade 1, Caderno, Prova Bimestral...).
CREATE TABLE assessments (
    id         BIGSERIAL PRIMARY KEY,
    class_id   BIGINT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    term_id    BIGINT NOT NULL REFERENCES terms (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('activity', 'notebook', 'exam_external', 'exam_teacher', 'bonus')),
    max_points NUMERIC(5, 2),
    position   INT NOT NULL DEFAULT 0,
    UNIQUE (class_id, term_id, name)
);

-- status: graded (vale score), absent (faltou / não fez), excused (atestado),
-- missing (sem nota lançada).
CREATE TABLE grades (
    id            BIGSERIAL PRIMARY KEY,
    assessment_id BIGINT NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    student_id    BIGINT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    score         NUMERIC(5, 2),
    status        TEXT NOT NULL CHECK (status IN ('graded', 'absent', 'excused', 'missing')),
    note          TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    BIGINT REFERENCES users (id) ON DELETE SET NULL,
    UNIQUE (assessment_id, student_id)
);
CREATE INDEX grades_student ON grades (student_id);

-- Histórico de alterações de nota (auditoria).
CREATE TABLE grade_history (
    id            BIGSERIAL PRIMARY KEY,
    assessment_id BIGINT NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    student_id    BIGINT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    old_score     NUMERIC(5, 2),
    old_status    TEXT,
    new_score     NUMERIC(5, 2),
    new_status    TEXT NOT NULL,
    source        TEXT NOT NULL CHECK (source IN ('manual', 'import')),
    changed_by    BIGINT REFERENCES users (id) ON DELETE SET NULL,
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX grade_history_student ON grade_history (student_id, changed_at DESC);

CREATE TABLE imports (
    id          BIGSERIAL PRIMARY KEY,
    term_id     BIGINT NOT NULL REFERENCES terms (id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    summary     JSONB NOT NULL,
    imported_by BIGINT REFERENCES users (id) ON DELETE SET NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
