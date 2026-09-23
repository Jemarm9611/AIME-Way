import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import MathText, { SolutionSteps } from '@/components/MathText';
import DiagramNotice from '@/components/DiagramNotice';
import DifficultyBadge from '@/components/DifficultyBadge';
import { fetchAllProblems } from '@/lib/queries';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

export default function ProblemBank() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [showSolution, setShowSolution] = useState({});

  const { data: problems = [], isLoading } = useQuery({
    queryKey: ['problems'],
    queryFn: async () => {
      const all = await fetchAllProblems();
      return all.sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        if (a.contest !== b.contest) return a.contest.localeCompare(b.contest);
        return a.number - b.number;
      });
    },
  });

  // Deep-link from Notes page: auto-expand a specific problem
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get('problem');
    if (targetId && problems.length > 0) {
      const target = problems.find(p => p.problem_id === targetId);
      if (target) {
        // Find which page it's on (after filtering)
        const filtered = problems.filter(p => {
          if (bandFilter !== 'all' && p.band !== bandFilter) return false;
          if (yearFilter !== 'all' && p.year !== parseInt(yearFilter)) return false;
          return true;
        });
        const idx = filtered.findIndex(p => p.problem_id === targetId);
        if (idx >= 0) {
          setPage(Math.floor(idx / PAGE_SIZE));
          setExpandedId(target.id);
        }
      }
    }
  }, [problems]);

  const years = useMemo(() => [...new Set(problems.map(p => p.year))].sort(), [problems]);

  const filtered = useMemo(() => {
    return problems.filter(p => {
      if (bandFilter !== 'all' && p.band !== bandFilter) return false;
      if (yearFilter !== 'all' && p.year !== parseInt(yearFilter)) return false;
      if (search) {
        const lower = search.toLowerCase();
        if (!p.problem_id.toLowerCase().includes(lower) &&
            !p.question.toLowerCase().includes(lower) &&
            !(p.topics || []).some(t => t.toLowerCase().includes(lower))) return false;
      }
      return true;
    });
  }, [problems, bandFilter, yearFilter, search]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSolution = (id) => {
    setShowSolution(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-heading font-bold mb-1">Problem Bank</h1>
        <p className="text-sm text-muted-foreground">{filtered.length} problems · 2002–2019 AMC 12 A/B</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search problems, topics..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm"
          />
        </div>
        <select
          value={bandFilter}
          onChange={(e) => { setBandFilter(e.target.value); setPage(0); }}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Bands</option>
          <option value="Easy">Easy</option>
          <option value="Medium">Medium</option>
          <option value="Hard">Hard</option>
          <option value="Brutal">Brutal</option>
        </select>
        <select
          value={yearFilter}
          onChange={(e) => { setYearFilter(e.target.value); setPage(0); }}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Problem list */}
      {isLoading ? (
        <p className="text-muted-foreground">Loading problems...</p>
      ) : (
        <div className="space-y-2">
          {pageItems.map((problem) => (
            <div key={problem.id} className="bg-card border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === problem.id ? null : problem.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-accent/30 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-mono text-muted-foreground flex-shrink-0">
                    {problem.year}{problem.contest}-P{problem.number}
                  </span>
                  <DifficultyBadge band={problem.band} rating={problem.difficulty_rating} />
                  <div className="flex gap-1 flex-wrap min-w-0">
                    {(problem.topics || []).slice(0, 3).map(t => (
                      <span key={t} className="text-xs px-2 py-0.5 bg-muted rounded-full text-muted-foreground">{t}</span>
                    ))}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                  {expandedId === problem.id ? 'Hide' : 'View'}
                </span>
              </button>

              {expandedId === problem.id && (
                <div className="px-4 pb-4 border-t border-border pt-4">
                  <DiagramNotice problem={problem} />
                  <div className="text-base leading-relaxed mb-4">
                    <MathText content={problem.question} block />
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-sm font-medium">Answer: {problem.answer}</span>
                    <button
                      onClick={() => toggleSolution(problem.id)}
                      className="flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      {showSolution[problem.id] ? <><EyeOff className="w-3.5 h-3.5" /> Hide Solution</> : <><Eye className="w-3.5 h-3.5" /> View Solution</>}
                    </button>
                  </div>
                  {showSolution[problem.id] && (
                    <div className="bg-muted/30 rounded-lg p-4">
                      <SolutionSteps steps={problem.solution_steps} />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-lg disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {pageCount}</span>
          <button
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-lg disabled:opacity-40"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}