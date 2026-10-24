package store

import "testing"

func TestRankTies(t *testing.T) {
	atestado := "Atestado"
	students := []BoardStudent{
		{ID: 1, Total: 7}, {ID: 2, Total: 9}, {ID: 3, Total: 7}, {ID: 4, Total: 5}, {ID: 5, Total: 10, Situation: &atestado},
	}
	rank(students, func(st *BoardStudent) (float64, bool) { return st.Total, st.Situation == nil },
		func(st *BoardStudent, r int) { st.Rank = &r })

	want := map[int64]int{2: 1, 1: 2, 3: 2, 4: 4}
	for _, st := range students {
		if w, ok := want[st.ID]; ok {
			if st.Rank == nil || *st.Rank != w {
				t.Errorf("aluno %d: rank %v, esperado %d", st.ID, st.Rank, w)
			}
		} else if st.Rank != nil {
			t.Errorf("aluno %d com situação não deveria ter rank", st.ID)
		}
	}
}
