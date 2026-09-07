export type SicarRow = Record<string, string> & { _row: number };
export const SICAR_COLUMNS: ReadonlyArray<
  readonly [string, string | null, string]
>;
export function normalizeHeader(value: unknown): string;
export function canonicalHeaders(values: unknown[]): string[];
export function rowFromValues(
  headers: string[],
  values: unknown[],
  rowNumber: number,
): SicarRow;
export function parseDecimal(value: unknown): number;
export function analyzeRows(
  rows: SicarRow[],
  options?: { physicalBarcodeVerified?: boolean },
): Record<string, unknown>;
export function compareRows(
  previousRows: SicarRow[],
  currentRows: SicarRow[],
): Record<string, unknown>;
export function sha256File(path: string): Promise<string>;
