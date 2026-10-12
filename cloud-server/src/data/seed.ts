import type { CRMData } from '../types';

// Public deployments start empty. Existing IndexedDB snapshots are retained;
// real business data enters a new workspace only through an explicit import.
export function createInitialData(): CRMData {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: new Date().toISOString(),
    customers: [],
    projects: [],
    cases: [],
    relationships: [],
  };
}
