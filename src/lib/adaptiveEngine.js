// Adaptive Selection Engine — deterministic, per-problem priority scoring.
// Selects problems for each session block based on learner state and performance history.

import { getLocalDateString, addDays, parseLocalDate } from './dateUtils';
import { bandFromRating } from './metrics';

// 4-week emphasis progression
export const PHASES = [
  { week: 1, name: 'Recognition & Specification', weights: { skillGap: 1.5, recency: 0.8, novelty: 1.2, difficulty: 0.7 } },
  { week: 2, name: 'Execution', weights: { skillGap: 1.2, recency: 0.8, novelty: 0.8, difficulty: 1.0, timePerf: 1.0 } },
  { week: 3, name: 'Timed Conversion', weights: { skillGap: 1.0, recency: 0.6, difficulty: 1.2, timePerf: 1.5 } },
  { week: 4, name: 'Stable 100+ Pathway', weights: { skillGap: 0.8, recency: 0.5, difficulty: 1.5, positionWeight: 1.2 } },
];

export function getCurrentPhase(phaseStartDate) {
  if (!phaseStartDate) return PHASES[0];
  const start = parseLocalDate(phaseStartDate);
  const today = parseLocalDate(getLocalDateString());
  const weeksElapsed = Math.floor((today - start) / (7 * 24 * 60 * 60 * 1000));
  const phaseIdx = Math.min(Math.floor(weeksElapsed), PHASES.length - 1);
  return PHASES[Math.max(0, phaseIdx)];
}

// Compute skill estimate per topic from attempts
export function computeTopicSkills(attempts) {
  const topicMap = {};
  for (const a of attempts) {
    const topics = a.topics || ['Uncategorized'];
    for (const t of topics) {
      if (!topicMap[t]) topicMap[t] = { correct: 0, total: 0 };
      topicMap[t].total++;
      if (a.correct) topicMap[t].correct++;
    }
  }
  const skills = {};
  for (const [t, v] of Object.entries(topicMap)) {
    skills[t] = v.total > 0 ? v.correct / v.total : 0.5; // default 0.5 for unseen
  }
  return skills;
}

// Score a single problem for selection
function scoreProblem(problem, context) {
  const { attempts, topicSkills, phase, attemptedProblemIds, recentAttempts, targetScore = 100 } = context;
  const w = phase.weights;
  let score = 0;

  // Skill gap: topics where learner is weak get higher priority
  const topics = problem.topics || ['Uncategorized'];
  const avgSkill = topics.reduce((s, t) => s + (topicSkills[t] || 0.5), 0) / topics.length;
  const skillGap = Math.max(0, 0.85 - avgSkill); // target 85% proficiency
  score += skillGap * (w.skillGap || 1.0);

  // Recency: avoid problems attempted recently
  const lastAttempt = attempts
    .filter(a => a.problem_id === problem.problem_id)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];
  if (lastAttempt) {
    const daysSince = (Date.now() - new Date(lastAttempt.created_date).getTime()) / (1000 * 60 * 60 * 24);
    score += Math.min(daysSince / 14, 1) * (w.recency || 0.8);
  } else {
    // Novelty: never-attempted problems get a boost
    score += (w.novelty || 0.8);
  }

  // Difficulty: phase-dependent preference
  const band = problem.band;
  const diffScore = band === 'Easy' ? 0.3 : band === 'Medium' ? 0.6 : band === 'Hard' ? 0.8 : 1.0;
  score += diffScore * (w.difficulty || 1.0);

  // Time performance: accurate-but-slow → efficiency work (easier problems)
  if (w.timePerf && lastAttempt && lastAttempt.correct && lastAttempt.time_spent) {
    const expectedTime = problem.difficulty_rating / 100 * 60; // rough heuristic
    if (lastAttempt.time_spent > expectedTime * 1.5) {
      // Slow but correct → reduce difficulty preference (efficiency work)
      score -= 0.3 * w.timePerf;
    }
  }

  // Position weight: in later phases, higher-numbered problems get more weight
  if (w.positionWeight && problem.number >= 21) {
    // Only weight #21-25 up if core score is improving (simplified: always in phase 4)
    score += 0.3 * w.positionWeight;
  }

  // Broad recent deterioration → temporarily lower difficulty
  if (recentAttempts && recentAttempts.length >= 5) {
    const recentAccuracy = recentAttempts.filter(a => a.correct).length / recentAttempts.length;
    if (recentAccuracy < 0.4 && band === 'Brutal') {
      score -= 0.5; // pull back from brutal if struggling
    }
  }

  // Repetition penalty: avoid re-attempting same problem too soon
  const attemptCount = attemptedProblemIds.filter(id => id === problem.problem_id).length;
  score -= attemptCount * 0.3;

  return Math.max(0, score);
}

// Select problems for a session block
export function selectProblems(allProblems, context, count, blockType) {
  const { attempts, topicSkills, phase } = context;
  const attemptedIds = new Set(attempts.map(a => a.problem_id));
  const dismissedIds = new Set(context.dismissedIds || []);

  let candidates = allProblems;

  if (blockType === 'warmup') {
    // Easy, unseen
    candidates = allProblems.filter(p => p.band === 'Easy' && !attemptedIds.has(p.problem_id));
    if (candidates.length < count) {
      candidates = allProblems.filter(p => p.band === 'Easy');
    }
  } else if (blockType === 'retrieval') {
    // Spaced retrieval: prioritize problems due for review per RetrievalItem schedule
    const today = getLocalDateString();
    const retrievals = context.retrievals || [];
    const dueItems = retrievals.filter(r => r.next_due && r.next_due <= today);
    const dueProblemIds = new Set(dueItems.map(r => r.problem_id));
    const dueProblems = allProblems.filter(p => dueProblemIds.has(p.problem_id));

    if (dueProblems.length >= count) {
      candidates = dueProblems;
    } else {
      // Fill remaining slots with never-attempted problems from worked topics
      const fillers = allProblems.filter(p => !attemptedIds.has(p.problem_id) && !dueProblemIds.has(p.problem_id));
      candidates = [...dueProblems, ...fillers];
      const workedTopics = new Set(Object.keys(topicSkills));
      if (workedTopics.size > 0 && candidates.length < count) {
        const fromWorkedTopics = allProblems.filter(p =>
          !attemptedIds.has(p.problem_id) && p.topics?.some(t => workedTopics.has(t))
        );
        candidates = [...candidates, ...fromWorkedTopics];
      }
    }
  } else if (blockType === 'mixed') {
    // All problems, unlabeled, chosen by priority score
    candidates = allProblems;
  } else if (blockType === 'repair') {
    // Weakest topic, then weakest band from error log
    const wrongAttempts = attempts.filter(a => !a.skipped && !a.correct);
    const topicErrorCount = {};
    for (const a of wrongAttempts) {
      for (const t of (a.topics || [])) {
        topicErrorCount[t] = (topicErrorCount[t] || 0) + 1;
      }
    }
    const weakestTopic = Object.entries(topicErrorCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (weakestTopic) {
      candidates = allProblems.filter(p => p.topics?.includes(weakestTopic));
    }
    // Then weakest band
    const bandErrorCount = { Easy: 0, Medium: 0, Hard: 0, Brutal: 0 };
    for (const a of wrongAttempts) {
      if (bandErrorCount[a.band] !== undefined) bandErrorCount[a.band]++;
    }
    const weakestBand = Object.entries(bandErrorCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (weakestBand) {
      const bandFiltered = candidates.filter(p => p.band === weakestBand);
      if (bandFiltered.length >= count) candidates = bandFiltered;
    }
  }

  // Exclude dismissed problems (permanently retired via Replace)
  candidates = candidates.filter(p => !dismissedIds.has(p.problem_id));

  // Score and sort
  const scored = candidates.map(p => ({
    problem: p,
    score: scoreProblem(p, context),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Add slight randomization among top candidates for variety
  const topN = Math.min(scored.length, count * 3);
  const top = scored.slice(0, topN);
  // Shuffle top candidates slightly
  for (let i = top.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    if (Math.abs(top[i].score - top[j].score) < 0.1) {
      [top[i], top[j]] = [top[j], top[i]];
    }
  }

  return top.slice(0, count).map(s => s.problem);
}

// Select a single replacement problem for a given block.
// Excludes the current problem, all already-queued problems for this block,
// and all previously attempted problems (so the replacement is genuinely new).
export function selectReplacementProblem(allProblems, context, blockType, excludeIds) {
  const { attempts, topicSkills, phase } = context;
  const attemptedIds = new Set(attempts.map(a => a.problem_id));
  const dismissedIds = new Set(context.dismissedIds || []);
  const excludeSet = new Set(excludeIds);

  let candidates = allProblems.filter(p =>
    !attemptedIds.has(p.problem_id) && !excludeSet.has(p.problem_id)
  );

  // Apply block-specific filtering (same logic as selectProblems)
  if (blockType === 'warmup') {
    const easyUnseen = candidates.filter(p => p.band === 'Easy');
    if (easyUnseen.length > 0) candidates = easyUnseen;
  } else if (blockType === 'repair') {
    const wrongAttempts = attempts.filter(a => !a.skipped && !a.correct);
    const topicErrorCount = {};
    for (const a of wrongAttempts) {
      for (const t of (a.topics || [])) {
        topicErrorCount[t] = (topicErrorCount[t] || 0) + 1;
      }
    }
    const weakestTopic = Object.entries(topicErrorCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (weakestTopic) {
      const topicFiltered = candidates.filter(p => p.topics?.includes(weakestTopic));
      if (topicFiltered.length > 0) candidates = topicFiltered;
    }
  }
  // 'retrieval' and 'mixed' use the full candidate set (scored below)

  if (candidates.length === 0) {
    // Fallback: relax the unattempted constraint, just exclude current/queued
    candidates = allProblems.filter(p => !excludeSet.has(p.problem_id));
  }
  // Exclude dismissed problems (permanently retired via Replace)
  candidates = candidates.filter(p => !dismissedIds.has(p.problem_id));
  if (candidates.length === 0) return null;

  // Score and pick the best
  const scored = candidates.map(p => ({
    problem: p,
    score: scoreProblem(p, context),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Slight randomization among top 5 for variety
  const topN = Math.min(scored.length, 5);
  const top = scored.slice(0, topN);
  const pick = top[Math.floor(Math.random() * top.length)];
  return pick.problem;
}

// Compute retrieval schedule update after an attempt
export function updateRetrievalInterval(item, success) {
  const ease = item.ease_factor || 2.5;
  const interval = item.interval_days || 1;
  let newEase = ease;
  let newInterval;

  if (success) {
    newInterval = Math.max(interval * ease, 1);
    newEase = Math.max(1.3, ease + 0.1);
  } else {
    newInterval = 1; // reset
    newEase = Math.max(1.3, ease - 0.2);
  }

  return {
    ...item,
    interval_days: Math.round(newInterval),
    ease_factor: newEase,
    next_due: addDays(getLocalDateString(), Math.round(newInterval)),
    retrieval_count: (item.retrieval_count || 0) + 1,
    last_success: success,
  };
}