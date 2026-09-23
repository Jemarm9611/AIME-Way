import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Lightbulb, SkipForward, CheckCircle2, Pause, Play, RefreshCw, Clock } from 'lucide-react';
import MathText from '@/components/MathText';
import DiagramNotice from '@/components/DiagramNotice';
import VoiceNoteRecorder from '@/components/VoiceNoteRecorder';
import { parseQuestionChoices, wrapMath } from '@/lib/parseQuestion';
import { cn } from '@/lib/utils';

const CHOICES = ['A', 'B', 'C', 'D', 'E'];

export default function ProblemAttempt({ problem, onSubmit, onSkip, paused, onTogglePause, onReplace, replacing, sessionElapsed, sessionTotal }) {
  const [selected, setSelected] = useState('');
  const [notes, setNotes] = useState([]);
  const [hints, setHints] = useState(null);
  const [revealedHints, setRevealedHints] = useState(0);
  const [hintLoading, setHintLoading] = useState(false);
  const [startTime, setStartTime] = useState(Date.now());
  const [problemTime, setProblemTime] = useState(0);

  const { statement: parsedStatement, choices: parsedChoices } = useMemo(
    () => parseQuestionChoices(problem?.question || ''),
    [problem?.id]
  );

  // Reset state when problem changes
  useEffect(() => {
    setSelected('');
    setNotes([]);
    setHints(null);
    setRevealedHints(0);
    setStartTime(Date.now());
    setProblemTime(0);
  }, [problem?.id]);

  // Per-problem timer (excludes paused time)
  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => {
      setProblemTime((Date.now() - startTime) / 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, [paused, startTime]);

  // Keyboard shortcuts (submit only — typing A-E no longer auto-selects)
  useEffect(() => {
    const handler = (e) => {
      if (paused) return;
      if (e.key === 'Enter' && selected) {
        handleSubmit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, paused]);

  const fetchHints = async () => {
    if (hints) {
      setRevealedHints(r => Math.min(r + 1, hints.length));
      return;
    }
    setHintLoading(true);
    try {
      const { base44 } = await import('@/api/base44Client');
      const res = await base44.functions.invoke('aiHint', { problem_id: problem.problem_id });
      const data = res.data;
      if (data?.hints) {
        setHints(data.hints);
        setRevealedHints(1);
      }
    } catch {
      setHints(['Try restating the problem and identifying the key mathematical structure.']);
      setRevealedHints(1);
    }
    setHintLoading(false);
  };

  const handleSubmit = useCallback(() => {
    if (!selected || paused) return;
    const reasoning = notes.map(n => n.content).filter(Boolean).join('\n---\n');
    onSubmit({
      chosen_answer: selected,
      time_spent: problemTime,
      reasoning,
      hint_used: revealedHints > 0,
      hint_levels_used: revealedHints,
    });
  }, [selected, paused, notes, problemTime, revealedHints, onSubmit]);

  const handleSkip = useCallback(() => {
    if (paused) return;
    const reasoning = notes.map(n => n.content).filter(Boolean).join('\n---\n');
    onSkip({
      chosen_answer: '',
      time_spent: problemTime,
      reasoning,
      hint_used: revealedHints > 0,
      hint_levels_used: revealedHints,
    });
  }, [paused, notes, problemTime, revealedHints, onSkip]);

  if (!problem) return null;

  return (
    <div className={cn('space-y-5 transition-opacity', paused && 'opacity-40 pointer-events-none')}>
      {/* Top bar: problem identity + timers + controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold font-mono">
            {problem.year} 12{problem.contest} #{problem.number}
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted rounded-lg text-sm font-mono text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            {Math.floor(problemTime / 60)}:{String(Math.floor(problemTime % 60)).padStart(2, '0')}
          </span>
          {sessionTotal && (
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary/10 text-primary rounded-lg text-sm font-mono font-medium">
              {Math.floor(sessionElapsed / 60)}:{String(Math.floor(sessionElapsed % 60)).padStart(2, '0')} / {sessionTotal}:00
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onReplace && (
            <button
              onClick={onReplace}
              disabled={replacing || paused}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', replacing && 'animate-spin')} />
              {replacing ? 'Replacing...' : 'Replace'}
            </button>
          )}
          {onTogglePause && (
            <button
              onClick={onTogglePause}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-accent"
            >
              {paused ? <><Play className="w-3.5 h-3.5" /> Resume</> : <><Pause className="w-3.5 h-3.5" /> Pause</>}
            </button>
          )}
        </div>
      </div>

      {/* Problem statement */}
      <div className="bg-card rounded-xl border border-border p-6">
        <DiagramNotice problem={problem} />
        <div className="text-lg leading-relaxed">
          <MathText content={parsedStatement} block />
        </div>
      </div>

      {/* Choices */}
      <div className="space-y-2">
        {CHOICES.map(letter => (
          <button
            key={letter}
            onClick={() => !paused && setSelected(letter)}
            className={cn(
              'w-full flex items-center gap-3 p-4 rounded-lg border transition-all text-left',
              selected === letter
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-border hover:bg-accent/30'
            )}
          >
            <span className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0',
              selected === letter ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}>
              {letter}
            </span>
            <span className="text-base flex-1">
              {parsedChoices[letter]
                ? <MathText content={wrapMath(parsedChoices[letter])} />
                : `Choice ${letter}`}
            </span>
          </button>
        ))}
      </div>

      {/* Voice notes */}
      <div className="bg-card rounded-xl border border-border p-4">
        <VoiceNoteRecorder notes={notes} onChange={setNotes} disabled={paused} />
      </div>

      {/* Hints */}
      <div>
        <button
          onClick={fetchHints}
          disabled={hintLoading || paused}
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <Lightbulb className="w-4 h-4 text-amber-500" />
          {hintLoading ? 'Generating hint...' : revealedHints > 0 ? `Reveal next hint (${revealedHints}/${hints?.length || 0})` : 'Reveal a Hint'}
        </button>
        {hints && revealedHints > 0 && (
          <div className="mt-3 space-y-2">
            {hints.slice(0, revealedHints).map((hint, i) => (
              <div key={i} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-3">
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Hint {i + 1}</span>
                <p className="text-sm mt-1">{hint}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit / Skip */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={handleSubmit}
          disabled={!selected || paused}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 disabled:opacity-40"
        >
          <CheckCircle2 className="w-4 h-4" /> Submit
        </button>
        <button
          onClick={handleSkip}
          disabled={paused}
          className="flex items-center justify-center gap-2 px-4 py-3 border border-border rounded-lg font-medium hover:bg-accent disabled:opacity-40"
        >
          <SkipForward className="w-4 h-4" /> Skip
        </button>
      </div>
    </div>
  );
}