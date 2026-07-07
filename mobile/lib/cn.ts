// Minimal className joiner (clsx-lite). Filters out falsy values so callers
// can write conditional classes inline: cn("base", isOn && "active").
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
