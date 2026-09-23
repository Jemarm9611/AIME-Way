// Shared paginated fetch utilities with deduplication.
// The list() skip parameter can return overlapping records at batch boundaries,
// so we deduplicate by record id to guarantee a clean set.

import { base44 } from '@/api/base44Client';

export async function fetchPaginated(listFn, limit = 500, maxSkip = 2000) {
  const all = []; let skip = 0;
  while (skip < maxSkip) {
    const batch = await listFn(skip);
    const seenIds = new Set(all.map(r => r.id));
    for (const r of batch) {
      if (!seenIds.has(r.id)) all.push(r);
    }
    if (batch.length < limit) break;
    skip += limit;
  }
  return all;
}

export const fetchAllProblems = () =>
  fetchPaginated(skip => base44.entities.Problem.list('year', 500, skip));

export const fetchAllAttempts = () =>
  fetchPaginated(skip => base44.entities.Attempt.list('-created_date', 500, skip));

export const fetchAllNotes = () =>
  fetchPaginated(skip => base44.entities.Note.list('-created_date', 500, skip));

export const fetchAllSessions = () =>
  fetchPaginated(skip => base44.entities.Session.list('-created_date', 200, skip), 200, 1000);

export const fetchAllSimulations = () =>
  base44.entities.Simulation.list('-created_date', 50);

export const fetchAllRetrievals = () =>
  base44.entities.RetrievalItem.list('-created_date', 200);

export const fetchAllChallenges = () =>
  fetchPaginated(skip => base44.entities.Challenge.list('-created_date', 200, skip), 200, 2000);