// Package textutil normaliza nomes vindos da planilha.
package textutil

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

var (
	parens = regexp.MustCompile(`\([^)]*\)`)
	spaces = regexp.MustCompile(`\s+`)
)

// CleanName remove espaços repetidos e nas pontas, mantendo acentos.
func CleanName(s string) string {
	return strings.TrimSpace(spaces.ReplaceAllString(s, " "))
}

// NormalizeName gera a chave de comparação de um nome: sem acentos, sem
// apelidos entre parênteses, maiúsculo e com espaços simples.
// "João  Gabriel (Jão)" e "JOAO GABRIEL" geram a mesma chave.
func NormalizeName(s string) string {
	s = parens.ReplaceAllString(s, " ")
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	out, _, err := transform.String(t, s)
	if err != nil {
		out = s
	}
	return strings.ToUpper(CleanName(out))
}
