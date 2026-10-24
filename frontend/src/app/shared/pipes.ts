import { Pipe, PipeTransform } from '@angular/core';
import { fmt } from '../core/stats';

const LOWER = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/** "JOÃO DA SILVA" -> "João da Silva"; com short=true -> "João S." */
export function displayName(name: string, short = false): string {
  const words = name
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && LOWER.has(w) ? w : w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1)));
  if (!short || words.length < 2) return words.join(' ');
  const last = [...words].reverse().find((w) => !LOWER.has(w) && !w.startsWith('('));
  return last && last !== words[0] ? `${words[0]} ${last.charAt(0)}.` : words[0];
}

@Pipe({ name: 'studentName' })
export class StudentNamePipe implements PipeTransform {
  transform(name: string, short = false): string {
    return displayName(name, short);
  }
}

@Pipe({ name: 'score' })
export class ScorePipe implements PipeTransform {
  transform(v: number | null | undefined, digits = 1): string {
    return fmt(v, digits);
  }
}
