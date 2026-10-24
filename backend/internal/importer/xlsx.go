// Package importer lê a planilha de notas do professor.
//
// Cada aba é uma turma. A linha de cabeçalho tem os alunos na coluna A, as
// avaliações nas colunas seguintes e uma coluna "Total". Tudo à direita do
// Total (tabelas auxiliares da Prova SEE etc.) é ignorado: os valores que
// importam já estão calculados nas colunas das avaliações.
package importer

import (
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"

	"brunog.lfvpc.cloud/notas/internal/textutil"
)

const (
	KindActivity     = "activity"
	KindNotebook     = "notebook"
	KindExamExternal = "exam_external"
	KindExamTeacher  = "exam_teacher"
	KindBonus        = "bonus"

	StatusGraded  = "graded"
	StatusAbsent  = "absent"
	StatusExcused = "excused"
	StatusMissing = "missing"
)

type Assessment struct {
	Name      string
	Kind      string
	MaxPoints *float64
	Position  int
	col       int
	unnamed   bool
}

type Cell struct {
	Score  *float64
	Status string
	Note   string
}

type Student struct {
	Name      string
	Situation string
	// Cells tem uma entrada por avaliação (mesma ordem de Sheet.Assessments);
	// nil quando a célula de uma avaliação bônus está vazia.
	Cells      []*Cell
	SheetTotal *float64
}

type Sheet struct {
	ClassName   string
	Assessments []Assessment
	Students    []Student
	Warnings    []string
}

// Parse lê todas as abas da planilha.
func Parse(r io.Reader) ([]Sheet, error) {
	f, err := excelize.OpenReader(r, excelize.Options{RawCellValue: true})
	if err != nil {
		return nil, fmt.Errorf("arquivo não é uma planilha .xlsx válida: %w", err)
	}
	defer f.Close()

	var sheets []Sheet
	for _, name := range f.GetSheetList() {
		rows, err := f.GetRows(name, excelize.Options{RawCellValue: true})
		if err != nil {
			return nil, fmt.Errorf("aba %q: %w", name, err)
		}
		sheet, ok := parseSheet(strings.TrimSpace(name), rows)
		if ok {
			sheets = append(sheets, sheet)
		}
	}
	if len(sheets) == 0 {
		return nil, fmt.Errorf("nenhuma aba com coluna \"Total\" encontrada")
	}
	return sheets, nil
}

func parseSheet(className string, rows [][]string) (Sheet, bool) {
	sheet := Sheet{ClassName: className}

	headerRow, totalCol := -1, -1
	for i, row := range rows {
		for j, v := range row {
			if textutil.NormalizeName(v) == "TOTAL" {
				headerRow, totalCol = i, j
				break
			}
		}
		if headerRow >= 0 {
			break
		}
	}
	if headerRow < 0 || totalCol < 2 {
		return sheet, false
	}
	header := rows[headerRow]
	body := rows[headerRow+1:]

	for col := 1; col < totalCol; col++ {
		title := textutil.CleanName(at(header, col))
		unnamed := title == ""
		if unnamed {
			// Coluna sem título: só vira avaliação se tiver algum valor
			// (às vezes o professor soma um ajuste fora das colunas nomeadas).
			if !columnHasData(body, col) {
				continue
			}
			title = "Ajuste (coluna " + colName(col) + ")"
		}
		kind, max := inferKind(title)
		sheet.Assessments = append(sheet.Assessments, Assessment{
			Name: title, Kind: kind, MaxPoints: max, Position: len(sheet.Assessments), col: col, unnamed: unnamed,
		})
	}

	seen := map[string]bool{}
	var lines []int // linha da planilha de cada aluno, para os avisos
	for i, row := range body {
		name := textutil.CleanName(at(row, 0))
		if name == "" {
			continue
		}
		key := textutil.NormalizeName(name)
		if seen[key] {
			sheet.Warnings = append(sheet.Warnings, fmt.Sprintf("linha %d: aluno %q repetido, ignorado", headerRow+i+2, name))
			continue
		}
		seen[key] = true

		st := Student{Name: name}
		for _, a := range sheet.Assessments {
			st.Cells = append(st.Cells, parseCell(at(row, a.col), a.Kind == KindBonus))
		}
		total := strings.TrimSpace(at(row, totalCol))
		if n, ok := parseNumber(total); ok {
			st.SheetTotal = &n
		} else if total != "" {
			st.Situation = textutil.CleanName(total)
		}
		sheet.Students = append(sheet.Students, st)
		lines = append(lines, headerRow+i+2)
	}

	dropUnusedAdjustments(&sheet)
	for i, st := range sheet.Students {
		if st.SheetTotal != nil {
			if sum := sumCells(st.Cells); math.Abs(sum-*st.SheetTotal) > 0.01 {
				sheet.Warnings = append(sheet.Warnings, fmt.Sprintf(
					"linha %d (%s): total da planilha %.2f difere da soma das avaliações %.2f",
					lines[i], st.Name, *st.SheetTotal, sum))
			}
		}
	}
	return sheet, true
}

// dropUnusedAdjustments remove colunas sem título que não entram no Total da
// planilha: a coluna fica só se somá-la explica o total em mais linhas do que
// deixá-la de fora.
func dropUnusedAdjustments(sheet *Sheet) {
	for ai := len(sheet.Assessments) - 1; ai >= 0; ai-- {
		if !sheet.Assessments[ai].unnamed {
			continue
		}
		with, without := 0, 0
		for _, st := range sheet.Students {
			c := st.Cells[ai]
			if c == nil || c.Score == nil || st.SheetTotal == nil {
				continue
			}
			sum := sumCells(st.Cells)
			if math.Abs(sum-*st.SheetTotal) <= 0.01 {
				with++
			}
			if math.Abs(sum-*c.Score-*st.SheetTotal) <= 0.01 {
				without++
			}
		}
		if with > without {
			continue
		}
		sheet.Assessments = append(sheet.Assessments[:ai], sheet.Assessments[ai+1:]...)
		for si := range sheet.Students {
			cells := sheet.Students[si].Cells
			sheet.Students[si].Cells = append(cells[:ai], cells[ai+1:]...)
		}
	}
	for i := range sheet.Assessments {
		sheet.Assessments[i].Position = i
	}
}

func parseCell(raw string, optional bool) *Cell {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		if optional {
			return nil
		}
		return &Cell{Status: StatusMissing}
	}
	if n, ok := parseNumber(raw); ok {
		return &Cell{Score: &n, Status: StatusGraded}
	}
	switch norm := textutil.NormalizeName(raw); {
	case strings.Contains(norm, "FALT"), strings.Contains(norm, "NAO FEZ"), strings.Contains(norm, "NAO ENTREG"):
		return &Cell{Status: StatusAbsent, Note: raw}
	case strings.Contains(norm, "ATESTADO"):
		return &Cell{Status: StatusExcused, Note: raw}
	default:
		return &Cell{Status: StatusMissing, Note: raw}
	}
}

func inferKind(title string) (string, *float64) {
	two := 2.0
	n := textutil.NormalizeName(title)
	switch {
	case strings.Contains(n, "EXTRA"), strings.Contains(n, "RECUPER"), strings.HasPrefix(n, "AJUSTE"), strings.Contains(n, "BONUS"):
		return KindBonus, nil
	case strings.Contains(n, "SEE"), strings.Contains(n, "SAEB"), strings.Contains(n, "EXTERNA"):
		return KindExamExternal, &two
	case strings.Contains(n, "PROVA"), strings.Contains(n, "AVALIACAO"):
		return KindExamTeacher, &two
	case strings.Contains(n, "CADERNO"):
		return KindNotebook, &two
	default:
		return KindActivity, &two
	}
}

func parseNumber(s string) (float64, bool) {
	s = strings.TrimSpace(strings.Replace(s, ",", ".", 1))
	if s == "" {
		return 0, false
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false
	}
	return math.Round(n*100) / 100, true
}

func sumCells(cells []*Cell) float64 {
	var sum float64
	for _, c := range cells {
		if c != nil && c.Score != nil {
			sum += *c.Score
		}
	}
	return sum
}

func columnHasData(rows [][]string, col int) bool {
	for _, r := range rows {
		if strings.TrimSpace(at(r, 0)) != "" && strings.TrimSpace(at(r, col)) != "" {
			return true
		}
	}
	return false
}

func at(row []string, i int) string {
	if i < len(row) {
		return row[i]
	}
	return ""
}

func colName(i int) string {
	name, _ := excelize.ColumnNumberToName(i + 1)
	return name
}
