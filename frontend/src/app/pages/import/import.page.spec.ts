import { guessTerm } from './import.page';

describe('guessTerm', () => {
  it('reads bimester and year from the file name', () => {
    expect(guessTerm('Notas 3° Bim Turma Exemplo 2026.xlsx')).toEqual({ number: 3, year: 2026 });
    expect(guessTerm('notas_2o_bimestre_2025.xlsx')).toEqual({ number: 2, year: 2025 });
    expect(guessTerm('notas.xlsx')).toEqual({ number: null, year: null });
  });
});
