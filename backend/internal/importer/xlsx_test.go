package importer

import (
	"bytes"
	"testing"

	"github.com/xuri/excelize/v2"
)

// Planilha sintética no mesmo formato da real (nomes fictícios).
func buildWorkbook(t *testing.T) *bytes.Buffer {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	f.SetSheetName("Sheet1", "1° A INF")
	rows := [][]any{
		{"Alunos", "Atividade 1", "Atividade 2", "Caderno", "Ativ. Extra", "Prova SEE", "Prova Bimestral", "", "Total", "Nome SEE", "%"},
		{"ANA  TESTE DA SILVA ", 2.0, 2.0, 1.5, 1.0, 2, 0.8, nil, 9.3, "ANA TESTE DA SILVA", 1},
		{"JOÃO EXEMPLO", "Faltou", "Faltou", "Faltou", nil, 0, nil, nil, 0},
		{"MARIA FICTÍCIA", 0.0, 2.0, 1.0, nil, 1, 0.2, 2.5, 6.7},
		{"PEDRO ATESTADO", "Faltou", nil, nil, nil, 0, nil, nil, "Atestado"},
		{"JOAO EXEMPLO", 1.0},
	}
	for i, r := range rows {
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		if err := f.SetSheetRow("1° A INF", cell, &r); err != nil {
			t.Fatal(err)
		}
	}
	// Coluna sem título com valor que NÃO entra no Total: deve ser descartada.
	f.NewSheet("2° B")
	f.SetSheetRow("2° B", "A1", &[]any{"ALUNOS", "Atividade 1", "Prova Bimestral", "", "Total"})
	f.SetSheetRow("2° B", "A2", &[]any{"CARLA FICTICIA", 2.0, 1.0, 5, 3})
	f.NewSheet("Notas")
	f.SetSheetRow("Notas", "A1", &[]any{"sem cabeçalho de total"})

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatal(err)
	}
	return &buf
}

func TestParse(t *testing.T) {
	sheets, err := Parse(buildWorkbook(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(sheets) != 2 {
		t.Fatalf("esperava 2 abas válidas, veio %d", len(sheets))
	}
	if b := sheets[1]; len(b.Assessments) != 2 || len(b.Students[0].Cells) != 2 || len(b.Warnings) != 0 {
		t.Errorf("coluna de ajuste fora do total deveria ser descartada: %+v %v", b.Assessments, b.Warnings)
	}
	s := sheets[0]
	if s.ClassName != "1° A INF" {
		t.Errorf("turma = %q", s.ClassName)
	}

	wantKinds := []string{KindActivity, KindActivity, KindNotebook, KindBonus, KindExamExternal, KindExamTeacher, KindBonus}
	if len(s.Assessments) != len(wantKinds) {
		t.Fatalf("avaliações = %+v", s.Assessments)
	}
	for i, k := range wantKinds {
		if s.Assessments[i].Kind != k {
			t.Errorf("avaliação %d (%s): kind %s, esperado %s", i, s.Assessments[i].Name, s.Assessments[i].Kind, k)
		}
	}
	if s.Assessments[6].Name != "Ajuste (coluna H)" {
		t.Errorf("coluna sem título = %q", s.Assessments[6].Name)
	}

	if len(s.Students) != 4 {
		t.Fatalf("alunos = %d (duplicado sem acento deveria ser ignorado)", len(s.Students))
	}
	ana := s.Students[0]
	if ana.Name != "ANA TESTE DA SILVA" || *ana.Cells[2].Score != 1.5 || *ana.SheetTotal != 9.3 {
		t.Errorf("ana = %+v", ana)
	}
	joao := s.Students[1]
	if joao.Cells[0].Status != StatusAbsent || joao.Cells[3] != nil || joao.Cells[5].Status != StatusMissing {
		t.Errorf("joao cells = %+v %+v %+v", joao.Cells[0], joao.Cells[3], joao.Cells[5])
	}
	if s.Students[3].Situation != "Atestado" {
		t.Errorf("situação = %q", s.Students[3].Situation)
	}
	// Maria: soma 6.7 inclui o ajuste da coluna H, então não deve gerar aviso de total.
	for _, w := range s.Warnings {
		if bytes.Contains([]byte(w), []byte("MARIA")) {
			t.Errorf("aviso inesperado: %s", w)
		}
	}
}
