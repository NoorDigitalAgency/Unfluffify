import { MarkRowSchema, type MarkRow } from "../domain/schema/marking";

export function refineXPathEntries(_html: string, rows: readonly MarkRow[]): readonly MarkRow[] {
  return rows.map((row) => MarkRowSchema.parse(row));
}
