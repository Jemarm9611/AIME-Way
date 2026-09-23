import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { fetchAllChallenges } from '@/lib/queries';
import { cn } from '@/lib/utils';

// Star toggle shown after submitting an incorrect answer.
// Marks the problem as a personal challenge to re-practice later.
export default function ChallengeStar({ problemId, topics = [] }) {
  const queryClient = useQueryClient();
  const { data: challenges = [] } = useQuery({ queryKey: ['challenges'], queryFn: fetchAllChallenges });
  const existing = challenges.find(c => c.problem_id === problemId);
  const [toggling, setToggling] = useState(false);

  const toggle = async () => {
    setToggling(true);
    try {
      if (existing) {
        await base44.entities.Challenge.delete(existing.id);
      } else {
        await base44.entities.Challenge.create({
          problem_id: problemId,
          starred_date: new Date().toISOString(),
          topics,
        });
      }
      queryClient.invalidateQueries(['challenges']);
    } finally {
      setToggling(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={toggling}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
        existing
          ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
          : 'border-border hover:bg-accent'
      )}
      title={existing ? 'Remove from challenges' : 'Mark as challenge to re-practice later'}
    >
      <Star className={cn('w-4 h-4', existing && 'fill-amber-400 text-amber-500')} />
      {existing ? 'Challenged' : 'Mark as challenge'}
    </button>
  );
}