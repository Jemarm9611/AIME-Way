import React, { useState, useEffect, useRef, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Flag, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import MathText, { SolutionSteps } from '@/components/MathText';
import DiagramNotice from '@/components/DiagramNotice';
import DifficultyBadge from '@/components/DifficultyBadge';
import { getLocalDateString } from '@/lib/dateUtils';
import { fetchAllProblems } from '@/lib/queries';
import { parseQuestionChoices, wrapMath } from '@/lib/parseQuestion';
import { cn } from '@/lib/utils';

const CHOICES = ['A', 'B', 'C', 'D', 'E'];
const TEST_MINUTES = 75;

function useProblems() {
  return useQuery({
    queryKey: ['problems'],
    queryFn: fetchAllProblems,
  });
}

export default function Simulation() {
  const queryClient = useQueryClient();
  const { data: problems = [], isLoading } = useProblems();
  const [view, setView] = useState('select'); // 'select' | 'test' | 'review'
  const [currentSim, setCurrentSim] = useState(null);
  const [contestProblems, setContestProblems] = useState([]);
  const [answers, setAnswers] = useState({});
  const [flagged, setFlagged] = useState([]);
  const [times, setTimes] = useState({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TEST_MINUTES * 60);
  const [problemStart, setProblemStart] = useState(Date.now());
  const timerRef = useRef(null);
  const submitTestRef = useRef(null);

  // Available full contests (25 problems each)
  const availableContests = useMemo(() => {
    const map = {};
    for (const p of problems) {
      const key = `${p.year}${p.contest}`;
      if (!map[key]) map[key] = { key, year: p.year, contest: p.contest, count: 0 };
      map[key].count++;
    }
    return Object.values(map).filter(c => c.count === 25).sort((a, b) => b.year - a.year || a.contest.localeCompare(b.contest));
  }, [problems]);

  const startTest = async (contest) => {
    const cp = problems
      .filter(p => p.year === contest.year && p.contest === contest.contest)
      .sort((a, b) => a.number - b.number);
    setContestProblems(cp);
    setAnswers({});
    setFlagged([]);
    setTimes({});
    setCurrentIdx(0);
    setTimeLeft(TEST_MINUTES * 60);
    setProblemStart(Date.now());

    const sim = await base44.entities.Simulation.create({
      sim_date: getLocalDateString(),
      contest_key: contest.key,
      year: contest.year,
      contest: contest.contest,
      status: 'in_progress',
      answers: {},
      flagged: [],
      times: {},
      started_at: new Date().toISOString(),
    });
    setCurrentSim(sim);
    setView('test');
  };

  // Keep submitTest ref current so the auto-submit timer always calls the latest closure
  useEffect(() => { submitTestRef.current = submitTest; });

  // Countdown timer
  useEffect(() => {
    if (view !== 'test') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          submitTestRef.current?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [view]);

  // Track time per problem
  useEffect(() => {
    if (view !== 'test') return;
    setProblemStart(Date.now());
  }, [currentIdx, view]);

  const recordTime = () => {
    const elapsed = (Date.now() - problemStart) / 1000;
    setTimes(prev => ({ ...prev, [currentIdx + 1]: (prev[currentIdx + 1] || 0) + elapsed }));
  };

  const selectAnswer = (letter) => {
    setAnswers(prev => ({ ...prev, [currentIdx + 1]: letter }));
  };

  const toggleFlag = () => {
    const num = currentIdx + 1;
    setFlagged(prev => prev.includes(num) ? prev.filter(n => n !== num) : [...prev, num]);
  };

  const goPrev = () => {
    recordTime();
    setCurrentIdx(idx => Math.max(0, idx - 1));
  };

  const goNext = () => {
    recordTime();
    setCurrentIdx(idx => Math.min(24, idx + 1));
  };

  const submitTest = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    recordTime();

    let correct = 0, blank = 0, wrong = 0;
    for (const p of contestProblems) {
      const ans = answers[p.number];
      if (!ans) blank++;
      else if (ans === p.answer) correct++;
      else wrong++;
    }
    const score = correct * 6 + blank * 1.5;

    const updated = await base44.entities.Simulation.update(currentSim.id, {
      status: 'completed',
      answers,
      flagged,
      times,
      completed_at: new Date().toISOString(),
      score,
      correct_count: correct,
      blank_count: blank,
      wrong_count: wrong,
    });
    setCurrentSim(updated);

    // Create attempt records for non-blank answers (feeds adaptive engine)
    for (const p of contestProblems) {
      const ans = answers[p.number];
      if (ans) {
        await base44.entities.Attempt.create({
          problem_id: p.problem_id,
          session_id: currentSim.id,
          source: 'simulation',
          block_type: 'simulation',
          chosen_answer: ans,
          correct: ans === p.answer,
          skipped: false,
          time_spent: times[p.number] || 0,
          reasoning: '',
          problem_number: p.number,
          difficulty_rating: p.difficulty_rating,
          band: p.band,
          topics: p.topics || [],
        });
      }
    }

    queryClient.invalidateQueries(['attempts', 'simulations']);
    setView('review');
  };

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  // Contest selection view
  if (view === 'select') {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-heading font-bold">Full AMC Simulation</h1>
          <p className="text-sm text-muted-foreground mt-1">25 problems · 75 minutes · official scoring</p>
        </div>

        {/* Contest selector */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h2 className="font-heading font-semibold mb-3">Start New Simulation</h2>
          <p className="text-sm text-muted-foreground mb-4">Select a full contest (all 25 problems):</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {availableContests.map(c => (
              <button
                key={c.key}
                onClick={() => startTest(c)}
                className="p-3 border border-border rounded-lg hover:bg-accent text-left transition-colors"
              >
                <p className="font-mono font-medium">{c.key}</p>
                <p className="text-xs text-muted-foreground">AMC 12 {c.contest}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Test view
  if (view === 'test') {
    const problem = contestProblems[currentIdx];
    const num = currentIdx + 1;
    const answeredCount = Object.keys(answers).length;
    const flaggedCount = flagged.length;

    return (
      <div className="space-y-4">
        {/* Timer + progress */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-mono font-medium">
              Problem {num} / 25
            </span>
            <span className="text-xs text-muted-foreground">
              {answeredCount} answered · {25 - answeredCount} remaining{flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ''}
            </span>
          </div>
          <span className={cn(
            'text-lg font-mono font-bold',
            timeLeft < 300 ? 'text-destructive' : 'text-primary'
          )}>
            {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
          </span>
        </div>

        {/* Answer grid — compact */}
        <div className="flex flex-wrap gap-1">
          {contestProblems.map((p, i) => {
            const n = i + 1;
            const answered = answers[n];
            const isFlagged = flagged.includes(n);
            const isCurrent = i === currentIdx;
            return (
              <button
                key={i}
                onClick={() => { recordTime(); setCurrentIdx(i); }}
                className={cn(
                  'h-8 w-8 rounded-md text-xs font-medium relative border flex items-center justify-center transition-colors',
                  isCurrent ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-border',
                  answered ? 'bg-primary/10' : 'bg-card'
                )}
              >
                {n}
                {answered && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full" />}
                {isFlagged && <span className="absolute -top-0.5 -left-0.5 w-1.5 h-1.5 bg-amber-500 rounded-full" />}
              </button>
            );
          })}
        </div>

        {/* Problem */}
        {problem && (() => {
          const { statement, choices } = parseQuestionChoices(problem.question);
          return (
          <div className="bg-card rounded-xl border border-border p-6">
            <DiagramNotice problem={problem} />
            <div className="text-lg leading-relaxed mb-5">
              <MathText content={statement} block />
            </div>
            <div className="space-y-2">
              {CHOICES.map(letter => (
                <button
                  key={letter}
                  onClick={() => selectAnswer(letter)}
                  className={cn(
                    'w-full flex items-center gap-3 p-4 rounded-lg border transition-all text-left',
                    answers[num] === letter
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:bg-accent/30'
                  )}
                >
                  <span className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0',
                    answers[num] === letter ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  )}>
                    {letter}
                  </span>
                  <span className="text-base flex-1">
                    {choices[letter]
                      ? <MathText content={wrapMath(choices[letter])} />
                      : `Choice ${letter}`}
                  </span>
                </button>
              ))}
            </div>
          </div>
          );
        })()}

        {/* Controls */}
        <div className="flex items-center justify-between">
          <button
            onClick={goPrev}
            disabled={currentIdx === 0}
            className="flex items-center gap-1 px-4 py-2 border border-border rounded-lg text-sm disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <button
            onClick={toggleFlag}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm',
              flagged.includes(num) ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400' : 'border border-border'
            )}
          >
            <Flag className="w-4 h-4" /> {flagged.includes(num) ? 'Unflag' : 'Flag for review'}
          </button>
          {currentIdx < 24 ? (
            <button
              onClick={goNext}
              className="flex items-center gap-1 px-4 py-2 border border-border rounded-lg text-sm"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={submitTest}
              className="flex items-center gap-1.5 px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
            >
              <CheckCircle2 className="w-4 h-4" /> Submit Test
            </button>
          )}
        </div>
      </div>
    );
  }

  // Review view
  if (view === 'review' && currentSim) {
    return <SimulationReview sim={currentSim} problems={contestProblems} onBack={() => setView('select')} />;
  }

  return null;
}

function SimulationReview({ sim, problems, onBack }) {
  const [selectedProblem, setSelectedProblem] = useState(null);
  const [diagnoses, setDiagnoses] = useState({});
  const [loadingDiag, setLoadingDiag] = useState({});

  const fetchDiagnosis = async (problem) => {
    const num = problem.number;
    setLoadingDiag(prev => ({ ...prev, [num]: true }));
    try {
      const res = await base44.functions.invoke('aiDiagnose', {
        problem_id: problem.problem_id,
        chosen_answer: sim.answers[num] || '',
        reasoning: '',
      });
      setDiagnoses(prev => ({ ...prev, [num]: res.data }));
      // Persist diagnosis to the simulation attempt record for analytics
      if (res.data) {
        try {
          const attempts = await base44.entities.Attempt.filter({ problem_id: problem.problem_id, session_id: sim.id });
          if (attempts.length > 0) {
            await base44.entities.Attempt.update(attempts[0].id, {
              diagnosis: res.data.diagnosis,
              error_class: res.data.error_class,
              secondary_errors: res.data.secondary_errors || [],
              transferable_lesson: res.data.transferable_lesson,
              ai_tier: res.data.ai_tier,
            });
          }
        } catch { /* non-critical */ }
      }
    } catch {
      setDiagnoses(prev => ({ ...prev, [num]: { diagnosis: 'Unavailable', ai_tier: 'rule_based' } }));
    }
    setLoadingDiag(prev => ({ ...prev, [num]: false }));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold">Simulation Review</h1>
        <button onClick={onBack} className="text-sm text-primary hover:underline">← New simulation</button>
      </div>

      {/* Score summary */}
      <div className="bg-gradient-to-br from-primary to-primary/70 text-primary-foreground rounded-xl p-6">
        <p className="text-sm opacity-80">{sim.contest_key} · {sim.sim_date}</p>
        <p className="text-4xl font-heading font-bold mt-1">{sim.score?.toFixed(1)} <span className="text-xl opacity-70">/ 150</span></p>
        <div className="flex gap-6 mt-3 text-sm">
          <span>✓ {sim.correct_count} correct</span>
          <span>✗ {sim.wrong_count} wrong</span>
          <span>○ {sim.blank_count} blank</span>
        </div>
      </div>

      {/* Per-problem review */}
      <div className="space-y-2">
        {problems.map((p, i) => {
          const num = p.number;
          const ans = sim.answers?.[num];
          const isCorrect = ans === p.answer;
          const isBlank = !ans;
          const isExpanded = selectedProblem === p.id;
          return (
            <div key={p.id} className="bg-card border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setSelectedProblem(isExpanded ? null : p.id)}
                className="w-full flex items-center gap-3 p-4 hover:bg-accent/30"
              >
                <span className="text-sm font-mono w-8">{num}</span>
                {isBlank ? (
                  <span className="text-muted-foreground text-sm">Blank</span>
                ) : isCorrect ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-500" />
                )}
                <span className="text-sm">
                  Your: <strong>{ans || '—'}</strong> · Correct: <strong className="text-green-600">{p.answer}</strong>
                </span>
                <DifficultyBadge band={p.band} rating={p.difficulty_rating} />
                <span className="text-xs text-muted-foreground ml-auto">
                  {sim.times?.[num] ? `${Math.floor(sim.times[num] / 60)}:${String(Math.floor(sim.times[num] % 60)).padStart(2, '0')}` : ''}
                </span>
              </button>
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
                  <DiagramNotice problem={p} />
                  <div className="text-base"><MathText content={p.question} block /></div>
                  {!isCorrect && !isBlank && !diagnoses[num] && (
                    <button
                      onClick={() => fetchDiagnosis(p)}
                      disabled={loadingDiag[num]}
                      className="text-sm text-primary hover:underline"
                    >
                      {loadingDiag[num] ? 'Analyzing...' : 'Get AI diagnosis →'}
                    </button>
                  )}
                  {diagnoses[num] && (
                    <div className="bg-muted/30 rounded-lg p-3">
                      <p className="text-sm">{diagnoses[num].diagnosis}</p>
                      {diagnoses[num].transferable_lesson && (
                        <p className="text-sm mt-2 text-primary"><strong>Lesson:</strong> {diagnoses[num].transferable_lesson}</p>
                      )}
                    </div>
                  )}
                  <div className="bg-muted/30 rounded-lg p-3">
                    <SolutionSteps steps={p.solution_steps} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}