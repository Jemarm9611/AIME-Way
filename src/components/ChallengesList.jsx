import React, { useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Star, Trash2, Play } from 'lucide-react';
import MathText from '@/components/MathText';
import DifficultyBadge from '@/components/DifficultyBadge';
import { parseQuestionChoices } from '@/lib/parseQuestion';

// Renders the user's starred challenges with a re-practice action.
export default function ChallengesList({ challenges, problems }) {
  const queryClient = useQueryClient();

  const problemMap = useMemo(() => {
    const m = {};
    for (const p of problems) m[p.problem_id] = p;
    return m;
  }, [problems]);

  const handleRemove = async (id) => {
    await base44.entities.Challenge.delete(id);
    queryClient.invalidateQueries(['challenges']);
  };

  if (challenges.length === 0) {
    return (
      <div className="text-center py-12">
        <Star className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-muted-foreground max-w-md mx-auto">
          No challenges yet. After getting a problem wrong in a session, tap the star to mark it here for re-practice.
        </p>
      </div>
    );
  }

  const sorted = [...challenges].sort((a, b) => new Date(b.starred_date) - new Date(a.starred_date));

  return (
    <div className="space-y-3">
      {sorted.map(ch => {
        const problem = problemMap[ch.problem_id];
        const statement = problem ? parseQuestionChoices(problem.question).statement : '';
        return (
          <div key={ch.id} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Star className="w-4 h-4 text-amber-500 fill-amber-400 flex-shrink-0" />
                <span className="text-sm font-mono text-muted-foreground">
                  {problem ? `${problem.year} 12${problem.contest} #${problem.number}` : ch.problem_id}
                </span>
                {problem && <DifficultyBadge band={problem.band} rating={problem.difficulty_rating} />}
                {ch.practiced_date && (
                  <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
                    Practiced {new Date(ch.practiced_date).toLocaleDateString()}
                  </span>
                )}
              </div>
              <button
                onClick={() => handleRemove(ch.id)}
                className="p-1 hover:bg-destructive/10 rounded"
                title="Remove from challenges"
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </button>
            </div>
            {problem && (
              <div className="text-sm text-muted-foreground mb-3 line-clamp-2">
                <MathText content={statement} />
              </div>
            )}
            <div className="flex items-center gap-3">
              <Link
                to={`/challenges/${encodeURIComponent(ch.problem_id)}`}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90"
              >
                <Play className="w-3.5 h-3.5" /> Practice again
              </Link>
              {problem && (
                <Link
                  to={`/problems?problem=${encodeURIComponent(ch.problem_id)}`}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  View in bank →
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}