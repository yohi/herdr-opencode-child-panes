const POSIX_SPECIALS = new Set(["'", "\\"]);

export function quoteShell(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  if (![...value].some((character) => POSIX_SPECIALS.has(character))) {
    return `'${value}'`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
