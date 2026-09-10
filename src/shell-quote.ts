const POSIX_SPECIALS = new Set(["'", "\\"]);
const ESCAPED_SINGLE_QUOTE = String.raw`'\''`;

export function quoteShell(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  if (![...value].some((character) => POSIX_SPECIALS.has(character))) {
    return `'${value}'`;
  }
  return `'${value.replaceAll("'", ESCAPED_SINGLE_QUOTE)}'`;
}
