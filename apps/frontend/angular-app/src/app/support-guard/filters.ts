import type { CaseRecord } from "./models";

export interface CaseFilters {
  search: string;
  status: string;
  priority: string;
  application: string;
  validation: string;
  sufficiency: string;
}

export const EMPTY_FILTERS: CaseFilters = { search: "", status: "", priority: "", application: "", validation: "", sufficiency: "" };

export function filterCases(records: CaseRecord[], filters: CaseFilters): CaseRecord[] {
  const term = filters.search.trim().toLowerCase();
  return records.filter((record) => {
    const item = record.supportCase;
    if (term && !`${item.id} ${item.summary}`.toLowerCase().includes(term)) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.application && item.application !== filters.application) return false;
    if (filters.validation && record.validationStatus !== filters.validation) return false;
    if (filters.sufficiency && record.sufficiency.status !== filters.sufficiency) return false;
    return true;
  });
}

export function distinct(records: CaseRecord[], pick: (record: CaseRecord) => string): string[] {
  return [...new Set(records.map(pick).filter(Boolean))].sort();
}
