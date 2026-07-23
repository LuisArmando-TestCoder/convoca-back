// ── CSV parsing ──────────────────────────────────────────────────────────────
// Maps an uploaded CSV (with a header row) to the four identity fields. Header
// names are matched loosely (case/space/underscore-insensitive) with common
// aliases, so operator spreadsheets "just work".

import { parse } from "@std/csv";

export interface RawRow {
  name: string;
  email: string;
  country: string;
  phone: string;
}

const ALIASES: Record<keyof RawRow, string[]> = {
  name: ["name", "fullname", "full name", "nombre"],
  email: ["email", "e-mail", "correo", "mail"],
  country: ["country", "pais", "país", "nation"],
  phone: ["phone", "telephone", "tel", "mobile", "cell", "telefono", "teléfono", "whatsapp"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\s-]+/g, " ");
}

function resolveColumns(headers: string[]): Record<keyof RawRow, number> {
  const norm = headers.map(normalizeHeader);
  const find = (field: keyof RawRow): number => {
    for (const alias of ALIASES[field]) {
      const idx = norm.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  return {
    name: find("name"),
    email: find("email"),
    country: find("country"),
    phone: find("phone"),
  };
}

/** Parses CSV text into rows. Missing columns yield empty strings (validated later). */
export function parseCsv(text: string): RawRow[] {
  const records = parse(text, { skipFirstRow: false }) as string[][];
  if (records.length < 2) return [];
  const cols = resolveColumns(records[0]);
  const at = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? "").trim() : "");
  return records.slice(1)
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => ({
      name: at(row, cols.name),
      email: at(row, cols.email),
      country: at(row, cols.country),
      phone: at(row, cols.phone),
    }));
}
