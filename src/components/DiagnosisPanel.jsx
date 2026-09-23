import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Eye, EyeOff, Loader2, ArrowRight, Tag } from 'lucide-react';
import MathText, { SolutionSteps } from '@/components/MathText';
import DiagramNotice from '@/components/DiagramNotice';
import DifficultyBadge from '@/components/DifficultyBadge';
import ChallengeStar from '@/components/ChallengeStar';
import { parseQuestionChoices, wrapMath } from '@/lib/parseQuestion';
import { cn } from '@/lib/utils';

const CHOICES = ['A', 'B', 'C', 'D', 'E'];

const TIER_LABELS = {
  platform: 'Platform AI',
  groq: 'Groq gpt-oss-120b',
  rule_based: 'Rule-based estimate',
};

export default function DiagnosisPanel({ problem, attemptData, attemptId, onNext }) {
  const [diagnosis, setDiagnosis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSolution, setShowSolution] = useState(false);

  const { statement: parsedStatement, choices: parsedChoices } = useMemo(
    () => parseQuestionChoices(problem?.question || ''),
    [problem?.id]
  );

  useEffect(() => {
    const fetchDiagnosis = async () => {
      setLoading(true);
      try {
        const res = await base44.functions.invoke('aiDiagnose', {
          problem_id: problem.problem_id,
          chosen_answer: attemptData.chosen_answer,
          reasoning: attemptData.reasoning,
        });
        setDiagnosis(res.data);
        // Persist diagnosis back to the Attempt record so Analytics can use error_class
        if (attemptId && res.data) {
          try {
            await base44.entities.Attempt.update(attemptId, {
              diagnosis: res.data.diagnosis,
              error_class: res.data.error_class,
              secondary_errors: res.data.secondary_errors || [],
              transferable_lesson: res.data.transferable_lesson,
              ai_tier: res.data.ai_tier,
            });
          } catch { /* non-critical — diagnosis still shown inline */ }
        }
      } catch {
        setDiagnosis({
          diagnosis: 'Diagnosis unavailable. Compare your reasoning against the official solution below.',
          error_class: 'none',
          transferable_lesson: 'Review the solution and identify where your approach diverged.',
          ai_tier: 'rule_based',
        });
      }
      setLoading(false);
    };
    fetchDiagnosis();
  }, [problem?.problem_id]);

  const isCorrect = attemptData.chosen_answer === problem.answer;

  return (
    <div className="space-y-5">
      {/* Problem statement — stays visible after submit for context */}
      <div className="bg-card rounded-xl border border-border p-6">
        <DiagramNotice problem={problem} />
        <div className="text-lg leading-relaxed mb-4">
          <MathText content={parsedStatement} block />
        </div>
        {Object.keys(parsedChoices).length > 0 && (
          <div className="space-y-2">
            {CHOICES.map(letter => {
              const isCorrectChoice = letter === problem.answer;
              const isYourChoice = letter === attemptData.chosen_answer;
              return (
                <div
                  key={letter}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border',
                    isCorrectChoice
                      ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                      : isYourChoice
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                      : 'border-border'
                  )}
                >
                  <span className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0',
                    isCorrectChoice
                      ? 'bg-green-500 text-white'
                      : isYourChoice
                      ? 'bg-red-500 text-white'
                      : 'bg-muted text-muted-foreground'
                  )}>
                    {letter}
                  </span>
                  <span className="text-base flex-1">
                    <MathText content={wrapMath(parsedChoices[letter])} />
                  </span>
                  {isCorrectChoice && <span className="text-xs text-green-600 font-medium">Correct</span>}
                  {isYourChoice && !isCorrectChoice && <span className="text-xs text-red-600 font-medium">Your answer</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Result + answers */}
      <div className={cn(
        'rounded-xl border p-5',
        isCorrect ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-900/40'
                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900/40'
      )}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading font-semibold text-lg">
            {isCorrect ? '✓ Correct' : '✗ Incorrect'}
          </h2>
          <div className="flex items-center gap-2">
            {/* Star — offered on any incorrect or skipped answer, to mark for re-practice */}
            {!isCorrect && (
              <ChallengeStar problemId={problem.problem_id} topics={problem.topics || []} />
            )}
            <DifficultyBadge band={problem.band} rating={problem.difficulty_rating} size="md" />
          </div>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <span>Your answer: <strong className={isCorrect ? 'text-green-600' : 'text-red-600'}>{attemptData.chosen_answer || '—'}</strong></span>
          <span>Correct answer: <strong className="text-green-600">{problem.answer}</strong></span>
          <span className="text-muted-foreground">Time: {Math.floor(attemptData.time_spent / 60)}:{String(Math.floor(attemptData.time_spent % 60)).padStart(2, '0')}</span>
        </div>
      </div>

      {/* AI Diagnosis */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading font-semibold">Diagnostic</h3>
          {/* Provenance tag */}
          {diagnosis && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Tag className="w-3 h-3" />
              {TIER_LABELS[diagnosis.ai_tier] || 'Unknown'}
            </span>
          )}
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Analyzing your reasoning...
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-base leading-relaxed">
              <MathText content={diagnosis?.diagnosis || ''} block />
            </div>
            {diagnosis?.error_class && diagnosis.error_class !== 'none' && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Primary error:</span>
                <span className="px-2 py-0.5 bg-muted rounded-full text-xs font-medium capitalize">{diagnosis.error_class}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transferable lesson */}
      {diagnosis && (
        <div className="bg-primary/5 rounded-xl border border-primary/20 p-5">
          <h3 className="font-heading font-semibold mb-2">Transferable Lesson</h3>
          <p className="text-base leading-relaxed">
            <MathText content={diagnosis.transferable_lesson || ''} block />
          </p>
        </div>
      )}

      {/* View/Hide Full Solution */}
      <div>
        <button
          onClick={() => setShowSolution(!showSolution)}
          className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          {showSolution ? <><EyeOff className="w-4 h-4" /> Hide Full Solution</> : <><Eye className="w-4 h-4" /> View Full Solution</>}
        </button>
        {showSolution && (
          <div className="mt-3 bg-card rounded-xl border border-border p-5">
            <SolutionSteps steps={problem.solution_steps} />
          </div>
        )}
      </div>

      {/* Next button */}
      <button
        onClick={onNext}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90"
      >
        Next <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}