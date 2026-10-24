// Package api expõe a API REST consumida pelo frontend.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"brunog.lfvpc.cloud/notas/internal/auth"
	"brunog.lfvpc.cloud/notas/internal/importer"
	"brunog.lfvpc.cloud/notas/internal/store"
)

const maxUpload = 20 << 20

type API struct {
	store   *store.Store
	auth    *auth.Service
	limiter *auth.Limiter
}

func New(s *store.Store, a *auth.Service) http.Handler {
	h := &API{store: s, auth: a, limiter: auth.NewLimiter(8, 15*time.Minute)}

	r := chi.NewRouter()
	r.Use(middleware.RealIP, middleware.Recoverer, middleware.Timeout(60*time.Second), securityHeaders)

	r.Get("/api/healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	r.Post("/api/auth/login", h.login)

	r.Group(func(r chi.Router) {
		r.Use(a.Middleware)
		r.Get("/api/auth/me", h.me)
		r.Post("/api/auth/password", h.changePassword)

		r.Get("/api/terms", h.listTerms)
		r.Post("/api/terms", h.createTerm)
		r.Patch("/api/terms/{id}", h.updateTerm)
		r.Delete("/api/terms/{id}", h.deleteTerm)

		r.Get("/api/classes", h.listClasses)
		r.Post("/api/classes", h.createClass)
		r.Patch("/api/classes/{id}", h.renameClass)
		r.Get("/api/classes/{id}/board", h.board)
		r.Get("/api/overview", h.overview)

		r.Get("/api/students", h.searchStudents)
		r.Post("/api/students", h.addStudent)
		r.Patch("/api/students/{id}", h.updateStudent)
		r.Delete("/api/students/{id}/terms/{termId}", h.unenroll)
		r.Get("/api/students/{id}/history", h.studentHistory)
		r.Get("/api/students/{id}/changes", h.gradeChanges)

		r.Post("/api/assessments", h.createAssessment)
		r.Put("/api/assessments/{id}", h.updateAssessment)
		r.Delete("/api/assessments/{id}", h.deleteAssessment)

		r.Put("/api/grades", h.saveGrades)
		r.Post("/api/import", h.importSheet)

		r.Group(func(r chi.Router) {
			r.Use(adminOnly)
			r.Get("/api/users", h.listUsers)
			r.Post("/api/users/{id}/password", h.resetPassword)
		})
	})
	return r
}

// ---------- autenticação ----------

func (h *API) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Username, Password string }
	if !readJSON(w, r, &in) {
		return
	}
	ip := clientIP(r)
	if !h.limiter.Allowed(ip) {
		writeError(w, http.StatusTooManyRequests, "muitas tentativas, aguarde alguns minutos")
		return
	}
	u, hash, err := h.store.UserByUsername(r.Context(), strings.TrimSpace(in.Username))
	if errors.Is(err, store.ErrNotFound) {
		auth.DummyCheck(in.Password)
	} else if err != nil {
		h.fail(w, err)
		return
	}
	if err != nil || !auth.CheckPassword(hash, in.Password) {
		h.limiter.Fail(ip)
		slog.Warn("login falhou", "ip", ip)
		writeError(w, http.StatusUnauthorized, "usuário ou senha inválidos")
		return
	}
	h.limiter.Reset(ip)
	token, exp, err := h.auth.Issue(u)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"token": token, "expiresAt": exp, "user": u})
}

func (h *API) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, auth.FromContext(r.Context()))
}

func (h *API) changePassword(w http.ResponseWriter, r *http.Request) {
	var in struct{ Current, New string }
	if !readJSON(w, r, &in) {
		return
	}
	u := auth.FromContext(r.Context())
	_, hash, err := h.store.UserByID(r.Context(), u.ID)
	if err != nil {
		h.fail(w, err)
		return
	}
	if !auth.CheckPassword(hash, in.Current) {
		writeError(w, http.StatusBadRequest, "senha atual incorreta")
		return
	}
	if msg := weakPassword(in.New, u.Role); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if err := h.store.SetPassword(r.Context(), u.ID, in.New); err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *API) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.store.ListUsers(r.Context())
	respond(w, users, err)
}

func (h *API) resetPassword(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct{ Password string }
	if !readJSON(w, r, &in) {
		return
	}
	target, _, err := h.store.UserByID(r.Context(), id)
	if err != nil {
		h.fail(w, err)
		return
	}
	if msg := weakPassword(in.Password, target.Role); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if err := h.store.SetPassword(r.Context(), id, in.Password); err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func weakPassword(pw, role string) string {
	min := 8
	if role == "admin" {
		min = 12
	}
	if len([]rune(pw)) < min {
		return "a nova senha deve ter pelo menos " + strconv.Itoa(min) + " caracteres"
	}
	return ""
}

func adminOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth.FromContext(r.Context()).Role != "admin" {
			writeError(w, http.StatusForbidden, "apenas o administrador pode fazer isso")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---------- bimestres e turmas ----------

func (h *API) listTerms(w http.ResponseWriter, r *http.Request) {
	terms, err := h.store.ListTerms(r.Context())
	respond(w, terms, err)
}

func (h *API) createTerm(w http.ResponseWriter, r *http.Request) {
	var in struct{ Year, Number int }
	if !readJSON(w, r, &in) {
		return
	}
	if msg := validTerm(in.Year, in.Number); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	t, err := h.store.EnsureTerm(r.Context(), in.Year, in.Number)
	respond(w, t, err)
}

func (h *API) updateTerm(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct{ Year, Number int }
	if !readJSON(w, r, &in) {
		return
	}
	if msg := validTerm(in.Year, in.Number); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	err := h.store.UpdateTerm(r.Context(), id, in.Year, in.Number)
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "esse bimestre já existe; exclua-o antes ou reimporte nele")
		return
	}
	noContent(w, h, err)
}

func (h *API) deleteTerm(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	noContent(w, h, h.store.DeleteTerm(r.Context(), id))
}

func (h *API) listClasses(w http.ResponseWriter, r *http.Request) {
	if termID, ok := queryID(r, "termId"); ok {
		classes, err := h.store.ClassesInTerm(r.Context(), termID)
		respond(w, classes, err)
		return
	}
	classes, err := h.store.ListClasses(r.Context())
	respond(w, classes, err)
}

func (h *API) createClass(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name string }
	if !readJSON(w, r, &in) || !required(w, in.Name, "nome da turma") {
		return
	}
	c, err := h.store.CreateClass(r.Context(), in.Name)
	respond(w, c, err)
}

func (h *API) renameClass(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct{ Name string }
	if !readJSON(w, r, &in) || !required(w, in.Name, "nome da turma") {
		return
	}
	noContent(w, h, h.store.RenameClass(r.Context(), id, in.Name))
}

func (h *API) board(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	termID, ok := queryID(r, "termId")
	if !ok {
		writeError(w, http.StatusBadRequest, "informe o bimestre (termId)")
		return
	}
	b, err := h.store.Board(r.Context(), id, termID)
	respond(w, b, err)
}

// overview devolve o quadro de todas as turmas do bimestre; as estatísticas
// comparativas são calculadas no frontend.
func (h *API) overview(w http.ResponseWriter, r *http.Request) {
	termID, ok := queryID(r, "termId")
	if !ok {
		writeError(w, http.StatusBadRequest, "informe o bimestre (termId)")
		return
	}
	classes, err := h.store.ClassesInTerm(r.Context(), termID)
	if err != nil {
		h.fail(w, err)
		return
	}
	boards := make([]*store.Board, 0, len(classes))
	for _, c := range classes {
		b, err := h.store.Board(r.Context(), c.ID, termID)
		if err != nil {
			h.fail(w, err)
			return
		}
		boards = append(boards, b)
	}
	writeJSON(w, 200, boards)
}

// ---------- alunos ----------

func (h *API) searchStudents(w http.ResponseWriter, r *http.Request) {
	list, err := h.store.SearchStudents(r.Context(), r.URL.Query().Get("q"))
	respond(w, list, err)
}

func (h *API) addStudent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name    string
		ClassID int64
		TermID  int64
	}
	if !readJSON(w, r, &in) || !required(w, in.Name, "nome do aluno") {
		return
	}
	st, err := h.store.AddStudent(r.Context(), in.Name, in.ClassID, in.TermID)
	respond(w, st, err)
}

func (h *API) updateStudent(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Name      *string
		TermID    int64
		Situation *string
		// SetSituation diferencia "não mexer" de "limpar situação".
		SetSituation bool
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Name != nil {
		if !required(w, *in.Name, "nome do aluno") {
			return
		}
		if err := h.store.RenameStudent(r.Context(), id, *in.Name); err != nil {
			h.fail(w, err)
			return
		}
	}
	if in.SetSituation {
		if err := h.store.SetSituation(r.Context(), id, in.TermID, in.Situation); err != nil {
			h.fail(w, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *API) unenroll(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	termID, ok := pathID(w, r, "termId")
	if !ok {
		return
	}
	noContent(w, h, h.store.Unenroll(r.Context(), id, termID))
}

func (h *API) studentHistory(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	hist, err := h.store.StudentHistory(r.Context(), id)
	respond(w, hist, err)
}

func (h *API) gradeChanges(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	list, err := h.store.GradeHistory(r.Context(), id)
	respond(w, list, err)
}

// ---------- avaliações e notas ----------

var validKinds = map[string]bool{
	importer.KindActivity: true, importer.KindNotebook: true, importer.KindExamExternal: true,
	importer.KindExamTeacher: true, importer.KindBonus: true,
}

func validAssessment(w http.ResponseWriter, in store.AssessmentInput) bool {
	if !required(w, in.Name, "nome da avaliação") {
		return false
	}
	if !validKinds[in.Kind] {
		writeError(w, http.StatusBadRequest, "tipo de avaliação inválido")
		return false
	}
	if in.MaxPoints != nil && (*in.MaxPoints < 0 || *in.MaxPoints > 100) {
		writeError(w, http.StatusBadRequest, "valor máximo inválido")
		return false
	}
	return true
}

func (h *API) createAssessment(w http.ResponseWriter, r *http.Request) {
	var in store.AssessmentInput
	if !readJSON(w, r, &in) || !validAssessment(w, in) {
		return
	}
	a, err := h.store.CreateAssessment(r.Context(), in)
	respond(w, a, err)
}

func (h *API) updateAssessment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in store.AssessmentInput
	if !readJSON(w, r, &in) || !validAssessment(w, in) {
		return
	}
	noContent(w, h, h.store.UpdateAssessment(r.Context(), id, in))
}

func (h *API) deleteAssessment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	noContent(w, h, h.store.DeleteAssessment(r.Context(), id))
}

var validStatus = map[string]bool{
	importer.StatusGraded: true, importer.StatusAbsent: true, importer.StatusExcused: true, importer.StatusMissing: true,
}

func (h *API) saveGrades(w http.ResponseWriter, r *http.Request) {
	var in []store.GradeInput
	if !readJSON(w, r, &in) {
		return
	}
	for _, g := range in {
		if !validStatus[g.Status] {
			writeError(w, http.StatusBadRequest, "situação de nota inválida")
			return
		}
		if g.Status == importer.StatusGraded && (g.Score == nil || *g.Score < 0 || *g.Score > 100) {
			writeError(w, http.StatusBadRequest, "nota inválida")
			return
		}
	}
	noContent(w, h, h.store.SaveGrades(r.Context(), auth.FromContext(r.Context()).ID, in))
}

func (h *API) importSheet(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload)
	if err := r.ParseMultipartForm(maxUpload); err != nil {
		writeError(w, http.StatusBadRequest, "arquivo muito grande ou inválido (máx. 20 MB)")
		return
	}
	year, _ := strconv.Atoi(r.FormValue("year"))
	number, _ := strconv.Atoi(r.FormValue("number"))
	if msg := validTerm(year, number); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "envie o arquivo da planilha")
		return
	}
	defer file.Close()
	if !strings.EqualFold(filepath.Ext(header.Filename), ".xlsx") {
		writeError(w, http.StatusBadRequest, "o arquivo precisa ser .xlsx")
		return
	}
	sheets, err := importer.Parse(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	summary, err := h.store.Import(r.Context(), auth.FromContext(r.Context()).ID, year, number, filepath.Base(header.Filename), sheets)
	respond(w, summary, err)
}

func validTerm(year, number int) string {
	if year < 2000 || year > 2100 {
		return "ano inválido"
	}
	if number < 1 || number > 4 {
		return "bimestre deve ser de 1 a 4"
	}
	return ""
}

// ---------- utilitários HTTP ----------

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "requisição inválida")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func respond(w http.ResponseWriter, v any, err error) {
	if err != nil {
		(&API{}).fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func noContent(w http.ResponseWriter, h *API, err error) {
	if err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *API) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "não encontrado")
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, "já existe um registro com esse nome")
	default:
		slog.Error("erro interno", "err", err)
		writeError(w, http.StatusInternalServerError, "erro interno")
	}
}

func required(w http.ResponseWriter, v, field string) bool {
	if strings.TrimSpace(v) == "" {
		writeError(w, http.StatusBadRequest, "informe o "+field)
		return false
	}
	return true
}

func pathID(w http.ResponseWriter, r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "id inválido")
		return 0, false
	}
	return id, true
}

func queryID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.URL.Query().Get(name), 10, 64)
	return id, err == nil && id > 0
}
