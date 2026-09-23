import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import ProblemAttempt from '@/components/ProblemAttempt';
import DiagnosisPanel from '@/components/DiagnosisPanel';
import { fetchAllProblems, fetchAllChallenges } from '@/lib/queries';

// Re-practice a starred challenge problem end-to-end: attempt → diagnosis → mark practiced.
export default function ChallengePractice() {
  const { problemId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: problems = [], isLoading } = useQuery({ queryKey: ['problems'], queryFn: fetchAllProblems });
  const problem = problems.find(p => p.problem_id === problemId);

  const [phase, setPhase] = useState('attempting');
  const [lastAttemptData, setLastAttemptData] = useState(null);
  const [lastAttemptId, setLastAttemptId] = useState(null);

  const handleSubmit = async (attemptData) => {
    if (!problem) return;
    const isCorrect = attemptData.chosen_answer === problem.answer;
    const attempt = await base44.entities.Attempt.create({
      problem_id: problem.problem_id,
      source: 'session',
      block_type: 'repair',
      chosen_answer: attemptData.chosen_answer,
      correct: isCorrect,
      skipped: !attemptData.chosen_answer,
      time_spent: attemptData.time_spent,
      reasoning: attemptData.reasoning,
      hint_used: attemptData.hint_used,
      hint_levels_used: attemptData.hint_levels_used,
      problem_number: problem.number,
      difficulty_rating: problem.difficulty_rating,
      band: problem.band,
      topics: problem.topics || [],
    });
    setLastAttemptData(attemptData);
    setLastAttemptId(attempt.id);
    setPhase('diagnosis');
    queryClient.invalidateQueries(['attempts']);
  };

  const handleNext = async () => {
    // Mark the challenge as practiced
    try {
      const challenges = await fetchAllChallenges();
      const ch = challenges.find(c => c.problem_id === problemId);
      if (ch) {
        await base44.entities.Challenge.update(ch.id, {
          practiced_date: new Date().toISOString(),
          attempt_count: (ch.attempt_count || 0) + 1,
        });
        queryClient.invalidateQueries(['challenges']);
      }
    } catch { /* non-critical */ }
    navigate('/notes');
  };

  if (isLoading || !problem) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/notes')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Challenges
      </button>

      <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-full text-xs font-medium">
          Challenge
        </span>
        {problem.year} 12{problem.contest} #{problem.number}
      </div>

      {phase === 'attempting' && (
        <ProblemAttempt problem={problem} onSubmit={handleSubmit} onSkip={handleSubmit} />
      )}
      {phase === 'diagnosis' && lastAttemptData && (
        <DiagnosisPanel
          problem={problem}
          attemptData={lastAttemptData}
          attemptId={lastAttemptId}
          onNext={handleNext}
        />
      )}
    </div>
  );
}