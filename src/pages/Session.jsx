import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import ProblemAttempt from '@/components/ProblemAttempt';
import DiagnosisPanel from '@/components/DiagnosisPanel';
import MathText from '@/components/MathText';
import { selectProblems, selectReplacementProblem, getCurrentPhase, computeTopicSkills, updateRetrievalInterval } from '@/lib/adaptiveEngine';
import { computeStreak } from '@/lib/metrics';
import { getLocalDateString, formatTime } from '@/lib/dateUtils';
import { fetchAllProblems, fetchAllAttempts, fetchAllSessions, fetchAllRetrievals } from '@/lib/queries';
import { cn } from '@/lib/utils';

const BLOCKS = [
  { key: 'warmup', label: 'Warm-Up', count: 3 },
  { key: 'retrieval', label: 'Spaced Retrieval', count: 3 },
  { key: 'mixed', label: 'Mixed Problems', count: 6 },
  { key: 'repair', label: 'Targeted Repair', count: 3 },
  { key: 'review', label: 'Review', count: 0 },
];

const SESSION_TOTAL_MIN = 90;

function useAllData() {
  const problemsQ = useQuery({ queryKey: ['problems'], queryFn: fetchAllProblems });
  const attemptsQ = useQuery({ queryKey: ['attempts'], queryFn: fetchAllAttempts });
  const sessionsQ = useQuery({ queryKey: ['sessions'], queryFn: fetchAllSessions });
  const profileQ = useQuery({
    queryKey: ['learnerProfile'],
    queryFn: async () => {
      const list = await base44.entities.LearnerProfile.list('-created_date', 10);
      if (list.length > 0) return list[0];
      return await base44.entities.LearnerProfile.create({
        phase_start_date: getLocalDateString(), current_phase: 1, topic_skill: {},
        bottlenecks: [], priorities: [], total_attempts: 0, total_correct: 0, streak_count: 0,
      });
    },
  });
  const retrievalsQ = useQuery({ queryKey: ['retrievals'], queryFn: fetchAllRetrievals });
  return {
    problems: problemsQ.data || [],
    problemsLoading: problemsQ.isLoading,
    attempts: attemptsQ.data || [],
    sessions: sessionsQ.data || [],
    profile: profileQ.data,
    retrievals: retrievalsQ.data || [],
  };
}

export default function Session() {
  const queryClient = useQueryClient();
  const { problems, problemsLoading, attempts, sessions, profile, retrievals } = useAllData();

  const today = getLocalDateString();
  const [session, setSession] = useState(null);
  const [blockProblemQueue, setBlockProblemQueue] = useState({});
  const [currentBlockIdx, setCurrentBlockIdx] = useState(0);
  const [currentProblemIdx, setCurrentProblemIdx] = useState(0);
  const [phase, setPhase] = useState('attempting'); // 'attempting' | 'diagnosis' | 'review' | 'completed'
  const [lastAttemptData, setLastAttemptData] = useState(null);
  const [lastAttemptId, setLastAttemptId] = useState(null);
  const [paused, setPaused] = useState(false);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const timerRef = useRef(null);

  // Find or create today's session
  useEffect(() => {
    if (problemsLoading) return;
    const existing = sessions.find(s => s.session_date === today);
    if (existing) {
      setSession(existing);
      setCurrentBlockIdx(BLOCKS.findIndex(b => b.key === existing.current_block));
      setSessionElapsed(existing.elapsed_seconds || 0);
      elapsedRef.current = existing.elapsed_seconds || 0;
      setPaused(existing.paused || false);
    } else if (!session && problems.length > 0) {
      createSession();
    }
  }, [sessions, today, problems]);

  // Timer — only ticks while actively attempting a problem; pauses during diagnosis/review
  useEffect(() => {
    if (paused || !session || session.status === 'completed' || phase !== 'attempting') return;
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setSessionElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [paused, session, phase]);

  // Persist elapsed time periodically
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(async () => {
      if (session.status !== 'completed') {
        await base44.entities.Session.update(session.id, { elapsed_seconds: elapsedRef.current });
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [session]);

  // Select problems for current block when entering it
  useEffect(() => {
    if (!session || problems.length === 0 || phase === 'completed') return;
    const block = BLOCKS[currentBlockIdx];
    if (!block || block.key === 'review') return;
    if (blockProblemQueue[block.key]) return; // already selected

    const topicSkills = computeTopicSkills(attempts);
    const phaseConfig = getCurrentPhase(profile?.phase_start_date);
    const recentAttempts = attempts.slice(0, 10);
    const context = {
      attempts, topicSkills, phase: phaseConfig,
      attemptedProblemIds: attempts.map(a => a.problem_id),
      recentAttempts, targetScore: 100,
      retrievals,
      dismissedIds,
    };
    const selected = selectProblems(problems, context, block.count, block.key);
    setBlockProblemQueue(prev => ({ ...prev, [block.key]: selected }));
  }, [currentBlockIdx, session, problems, attempts, profile, blockProblemQueue, phase]);

  const createSession = async () => {
    const newSession = await base44.entities.Session.create({
      session_date: today,
      status: 'in_progress',
      current_block: 'warmup',
      block_index: 0,
      problem_ids: [],
      attempted_problem_ids: [],
      started_at: new Date().toISOString(),
      elapsed_seconds: 0,
      paused: false,
    });
    setSession(newSession);
    queryClient.invalidateQueries(['sessions']);
  };

  const currentBlock = BLOCKS[currentBlockIdx];
  const currentProblems = blockProblemQueue[currentBlock?.key] || [];
  const currentProblem = currentProblems[currentProblemIdx];

  const handleSubmit = async (attemptData) => {
    if (!currentProblem) return;
    const isCorrect = attemptData.chosen_answer === currentProblem.answer;
    const topics = currentProblem.topics || [];
    const attempt = await base44.entities.Attempt.create({
      problem_id: currentProblem.problem_id,
      session_id: session?.id,
      source: 'session',
      block_type: currentBlock.key,
      chosen_answer: attemptData.chosen_answer,
      correct: isCorrect,
      skipped: !attemptData.chosen_answer,
      time_spent: attemptData.time_spent,
      reasoning: attemptData.reasoning,
      hint_used: attemptData.hint_used,
      hint_levels_used: attemptData.hint_levels_used,
      problem_number: currentProblem.number,
      difficulty_rating: currentProblem.difficulty_rating,
      band: currentProblem.band,
      topics,
    });

    // Save notes
    if (attemptData.reasoning) {
      const noteParts = attemptData.reasoning.split('\n---\n');
      for (const part of noteParts) {
        if (part.trim()) {
          await base44.entities.Note.create({
            problem_id: currentProblem.problem_id,
            content: part.trim(),
            note_date: new Date().toISOString(),
            topics,
          });
        }
      }
    }

    // Update session
    const attempted = [...(session.attempted_problem_ids || []), currentProblem.problem_id];
    await base44.entities.Session.update(session.id, {
      attempted_problem_ids: attempted,
    });

    setLastAttemptData(attemptData);
    setLastAttemptId(attempt.id);
    setPhase('diagnosis');
    queryClient.invalidateQueries(['attempts', 'notes']);

    // Create or update RetrievalItem for spaced retrieval scheduling
    try {
      const existing = retrievals.find(r => r.problem_id === currentProblem.problem_id);
      if (existing) {
        const updated = updateRetrievalInterval(existing, isCorrect);
        await base44.entities.RetrievalItem.update(existing.id, {
          interval_days: updated.interval_days,
          ease_factor: updated.ease_factor,
          next_due: updated.next_due,
          retrieval_count: updated.retrieval_count,
          last_success: updated.last_success,
        });
      } else {
        const newItem = updateRetrievalInterval(
          { problem_id: currentProblem.problem_id, topic: topics[0] || 'Uncategorized', interval_days: 1, ease_factor: 2.5, retrieval_count: 0 },
          isCorrect
        );
        await base44.entities.RetrievalItem.create({
          problem_id: currentProblem.problem_id,
          topic: topics[0] || 'Uncategorized',
          next_due: newItem.next_due,
          interval_days: newItem.interval_days,
          ease_factor: newItem.ease_factor,
          retrieval_count: newItem.retrieval_count,
          last_success: newItem.last_success,
        });
      }
      queryClient.invalidateQueries(['retrievals']);
    } catch { /* non-critical */ }
  };

  const handleNext = async () => {
    setPhase('attempting');
    setLastAttemptData(null);

    // Advance problem index
    if (currentProblemIdx + 1 < currentProblems.length) {
      setCurrentProblemIdx(currentProblemIdx + 1);
    } else {
      // Block done, advance to next block
      const nextIdx = currentBlockIdx + 1;
      if (nextIdx < BLOCKS.length) {
        setCurrentBlockIdx(nextIdx);
        setCurrentProblemIdx(0);
        const nextBlock = BLOCKS[nextIdx];
        await base44.entities.Session.update(session.id, { current_block: nextBlock.key });
      }
    }

  };

  const completeSession = async () => {
    await base44.entities.Session.update(session.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    setPhase('completed');
    queryClient.invalidateQueries(['sessions']);

    // Update learner profile
    if (profile) {
      const allAttempts = await queryClient.fetchQuery({
        queryKey: ['attempts'],
        queryFn: fetchAllAttempts,
      });
      const topicSkills = computeTopicSkills(allAttempts);
      const total = allAttempts.length;
      const correct = allAttempts.filter(a => a.correct).length;
      // Compute bottlenecks
      const wrong = allAttempts.filter(a => !a.skipped && !a.correct);
      const topicErr = {};
      for (const a of wrong) for (const t of (a.topics || [])) topicErr[t] = (topicErr[t] || 0) + 1;
      const bottlenecks = Object.entries(topicErr).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
      // Compute streak from completed session dates
      const allSessions = await base44.entities.Session.list('-created_date', 50);
      const completedDates = allSessions
        .filter(s => s.status === 'completed')
        .map(s => s.session_date);
      const streak = computeStreak(completedDates);

      await base44.entities.LearnerProfile.update(profile.id, {
        topic_skill: topicSkills,
        total_attempts: total,
        total_correct: correct,
        bottlenecks,
        last_session_date: today,
        streak_count: streak,
      });
      queryClient.invalidateQueries(['learnerProfile']);
    }
  };

  const togglePause = async () => {
    const newPaused = !paused;
    setPaused(newPaused);
    if (session) {
      await base44.entities.Session.update(session.id, { paused: newPaused });
    }
  };

  const [replacing, setReplacing] = useState(false);
  const [dismissedIds, setDismissedIds] = useState([]);

  // Seed dismissed list from learner profile
  useEffect(() => {
    if (profile?.dismissed_problem_ids) setDismissedIds(profile.dismissed_problem_ids);
  }, [profile?.id]);

  const handleReplace = async () => {
    if (!currentProblem || replacing || paused) return;
    setReplacing(true);
    try {
      const topicSkills = computeTopicSkills(attempts);
      const phaseConfig = getCurrentPhase(profile?.phase_start_date);
      const recentAttempts = attempts.slice(0, 10);
      const context = {
        attempts, topicSkills, phase: phaseConfig,
        attemptedProblemIds: attempts.map(a => a.problem_id),
        recentAttempts, targetScore: 100,
        retrievals,
        dismissedIds,
      };
      // Exclude the current problem and all other problems already queued in this block
      const excludeIds = currentProblems.map(p => p.problem_id);
      const replacement = selectReplacementProblem(problems, context, currentBlock.key, excludeIds);
      if (!replacement) {
        setReplacing(false);
        return;
      }
      // Permanently retire the replaced problem so it never reappears
      const retiredId = currentProblem.problem_id;
      setDismissedIds(prev => [...new Set([...prev, retiredId])]);
      if (profile) {
        try {
          const updated = [...new Set([...(profile.dismissed_problem_ids || []), retiredId])];
          await base44.entities.LearnerProfile.update(profile.id, { dismissed_problem_ids: updated });
          queryClient.invalidateQueries(['learnerProfile']);
        } catch { /* non-critical */ }
      }
      // Swap the current problem in the queue with the replacement
      setBlockProblemQueue(prev => {
        const queue = [...(prev[currentBlock.key] || [])];
        queue[currentProblemIdx] = replacement;
        return { ...prev, [currentBlock.key]: queue };
      });
    } finally {
      setReplacing(false);
    }
  };

  // Loading state
  if (problemsLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  // No session yet
  if (!session) {
    return <p className="text-muted-foreground">Initializing session...</p>;
  }

  // Session completed
  if (session.status === 'completed' || phase === 'completed') {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h1 className="text-2xl font-heading font-bold mb-2">Session Complete</h1>
        <p className="text-muted-foreground mb-6">Great work today. Your learner profile has been updated.</p>
        <div className="bg-card rounded-xl border border-border p-5 text-left space-y-2">
          <p className="text-sm"><span className="text-muted-foreground">Duration:</span> {formatTime(sessionElapsed)}</p>
          <p className="text-sm"><span className="text-muted-foreground">Problems attempted:</span> {session.attempted_problem_ids?.length || 0}</p>
        </div>
      </div>
    );
  }

  // Review block — session summary before completion
  if (currentBlock?.key === 'review') {
    const sessionAttempts = attempts.filter(a => a.session_id === session.id);
    const sessionCorrect = sessionAttempts.filter(a => a.correct).length;
    const sessionWrong = sessionAttempts.filter(a => !a.correct).length;
    return (
      <div className="max-w-lg mx-auto py-8 space-y-5">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-primary mx-auto mb-3" />
          <h1 className="text-xl font-heading font-bold mb-1">Session Review</h1>
          <p className="text-sm text-muted-foreground">All blocks complete. Review your performance and finish.</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Duration</span>
            <span className="text-sm font-mono font-medium">{formatTime(sessionElapsed)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Problems attempted</span>
            <span className="text-sm font-medium">{sessionAttempts.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-green-600">Correct</span>
            <span className="text-sm font-medium">{sessionCorrect}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-red-600">Incorrect</span>
            <span className="text-sm font-medium">{sessionWrong}</span>
          </div>
        </div>
        <button onClick={completeSession} className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90">
          Complete Session
        </button>
      </div>
    );
  }

  // Paused overlay
  if (paused) {
    return (
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="text-center">
          <Pause className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-lg font-medium mb-4">Session Paused</p>
          <button onClick={togglePause} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg mx-auto">
            <Play className="w-4 h-4" /> Resume
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Block indicator + progress + session timer */}
      <div className="flex items-center justify-between gap-4">
        {/* Block pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {BLOCKS.map((b, i) => (
            <div key={b.key} className="flex items-center gap-1">
              <span className={cn(
                'text-xs px-2.5 py-1 rounded-full transition-colors',
                i === currentBlockIdx ? 'bg-primary text-primary-foreground font-semibold' :
                i < currentBlockIdx ? 'bg-green-500/15 text-green-700 dark:text-green-400 font-medium' :
                'bg-muted text-muted-foreground'
              )}>
                {b.label}
              </span>
              {i < BLOCKS.length - 1 && <span className="text-muted-foreground/40 text-xs">→</span>}
            </div>
          ))}
        </div>
        {/* Progress + session timer */}
        <div className="flex items-center gap-3">
          {currentBlock && currentProblems.length > 0 && phase !== 'completed' && currentBlock.key !== 'review' && (
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-semibold font-mono">
                {Math.min(currentProblemIdx + 1, currentProblems.length)} / {currentProblems.length}
              </span>
              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${(currentProblemIdx / currentProblems.length) * 100}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {currentProblems.length - currentProblemIdx} left
              </span>
            </div>
          )}
          <span className="px-3 py-1.5 bg-muted rounded-lg text-sm font-mono font-medium">
            {formatTime(sessionElapsed)} / {SESSION_TOTAL_MIN}:00
          </span>
        </div>
      </div>

      {/* Problem or Diagnosis */}
      {phase === 'attempting' && currentProblem && (
        <ProblemAttempt
          problem={currentProblem}
          onSubmit={handleSubmit}
          onSkip={handleSubmit}
          paused={paused}
          onTogglePause={togglePause}
          onReplace={handleReplace}
          replacing={replacing}
          sessionElapsed={sessionElapsed}
          sessionTotal={SESSION_TOTAL_MIN}
        />
      )}
      {phase === 'diagnosis' && currentProblem && lastAttemptData && (
        <DiagnosisPanel
          problem={currentProblem}
          attemptData={lastAttemptData}
          attemptId={lastAttemptId}
          onNext={handleNext}
        />
      )}
      {phase === 'attempting' && !currentProblem && currentBlock && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading problems for {currentBlock.label}...</p>
        </div>
      )}
    </div>
  );
}