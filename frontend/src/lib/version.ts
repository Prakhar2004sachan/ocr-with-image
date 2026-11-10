/** Minimum backend version that embeds figures in exports. */
export const FIGURE_EXPORT_VERSION = '1.1.0'

function parseVersion(value: string | null | undefined): number[] {
  if (!value) return [0, 0, 0]
  return value
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
}

/** Compare dotted versions without adding a dependency. */
export function versionAtLeast(current: string | null | undefined, minimum: string): boolean {
  const left = parseVersion(current)
  const right = parseVersion(minimum)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return true
}

export function supportsFigureExports(version: string | null | undefined): boolean {
  return versionAtLeast(version, FIGURE_EXPORT_VERSION)
}
