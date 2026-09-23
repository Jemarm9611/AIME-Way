import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Trash2, Layers, List, MessageSquare, Star } from 'lucide-react';
import MathText from '@/components/MathText';
import ChallengesList from '@/components/ChallengesList';
import DifficultyBadge from '@/components/DifficultyBadge';
import { fetchAllNotes, fetchAllProblems, fetchAllAttempts, fetchAllChallenges } from '@/lib/queries';
import { cn } from '@/lib/utils';

function useNotes() {
  return useQuery({ queryKey: ['notes'], queryFn: fetchAllNotes });
}

function useProblems() {
  return useQuery({ queryKey: ['problems'], queryFn: fetchAllProblems });
}

function useAttempts() {
  return useQuery({ queryKey: ['attempts'], queryFn: fetchAllAttempts });
}

function useChallenges() {
  return useQuery({ queryKey: ['challenges'], queryFn: fetchAllChallenges });
}

export default function Notes() {
  const queryClient = useQueryClient();
  const { data: notes = [], isLoading: notesLoading } = useNotes();
  const { data: problems = [] } = useProblems();
  const { data: attempts = [] } = useAttempts();
  const { data: challenges = [] } = useChallenges();
  const [tab, setTab] = useState('notes');
  const [groupByTopic, setGroupByTopic] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const problemMap = useMemo(() => {
    const m = {};
    for (const p of problems) m[p.problem_id] = p;
    return m;
  }, [problems]);

  // Group notes by problem
  const notesByProblem = useMemo(() => {
    const m = {};
    for (const note of notes) {
      if (!m[note.problem_id]) m[note.problem_id] = [];
      m[note.problem_id].push(note);
    }
    // Sort each thread newest-first
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    }
    return m;
  }, [notes]);

  // Group by topic
  const notesByTopic = useMemo(() => {
    const m = {};
    for (const note of notes) {
      const problem = problemMap[note.problem_id];
      const topics = problem?.topics || ['Uncategorized'];
      for (const t of topics) {
        if (!m[t]) m[t] = [];
        m[t].push(note);
      }
    }
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    }
    return m;
  }, [notes, problemMap]);

  const problemAttemptCount = useMemo(() => {
    const m = {};
    for (const a of attempts) {
      m[a.problem_id] = (m[a.problem_id] || 0) + 1;
    }
    return m;
  }, [attempts]);

  const handleDeleteNote = async (noteId) => {
    await base44.entities.Note.delete(noteId);
    queryClient.invalidateQueries(['notes']);
  };

  const handleDeleteThread = async (problemId) => {
    const threadNotes = notesByProblem[problemId] || [];
    for (const n of threadNotes) {
      await base44.entities.Note.delete(n.id);
    }
    queryClient.invalidateQueries(['notes']);
    setExpandedId(null);
  };

  if (notesLoading) return <p className="text-muted-foreground">Loading notes...</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Notes Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">{tab === 'challenges' ? `${challenges.length} challenges to master` : `${notes.length} notes across ${Object.keys(notesByProblem).length} problems`}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setTab('notes')}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-sm', tab === 'notes' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
            >
              <MessageSquare className="w-4 h-4" /> Notes
            </button>
            <button
              onClick={() => setTab('challenges')}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-sm', tab === 'challenges' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
            >
              <Star className="w-4 h-4" /> Challenges
              {challenges.length > 0 && <span className="ml-0.5 text-xs opacity-70">{challenges.length}</span>}
            </button>
          </div>
          {tab === 'notes' && (
            <button
              onClick={() => setGroupByTopic(!groupByTopic)}
              className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm hover:bg-accent"
            >
              {groupByTopic ? <><List className="w-4 h-4" /> Group by problem</> : <><Layers className="w-4 h-4" /> Group by topic</>}
            </button>
          )}
        </div>
      </div>

      {tab === 'challenges' ? (
        <ChallengesList challenges={challenges} problems={problems} />
      ) : notes.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">No notes yet. Record voice notes during sessions to build your notes hub.</p>
      ) : groupByTopic ? (
        /* Grouped by topic */
        <div className="space-y-4">
          {Object.entries(notesByTopic).sort((a, b) => b[1].length - a[1].length).map(([topic, topicNotes]) => (
            <TopicGroup key={topic} topic={topic} notes={topicNotes} problemMap={problemMap} onDeleteNote={handleDeleteNote} />
          ))}
        </div>
      ) : (
        /* Grouped by problem */
        <div className="space-y-2">
          {Object.entries(notesByProblem).map(([problemId, threadNotes]) => {
            const problem = problemMap[problemId];
            const isExpanded = expandedId === problemId;
            return (
              <div key={problemId} className="bg-card border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : problemId)}
                  className="w-full flex items-center justify-between p-4 hover:bg-accent/30"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
                    <span className="text-sm font-mono text-muted-foreground flex-shrink-0">
                      {problem ? `${problem.year}${problem.contest}-P${problem.number}` : problemId}
                    </span>
                    {problem && <DifficultyBadge band={problem.band} rating={problem.difficulty_rating} />}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" /> {threadNotes.length}
                    </span>
                    <span className="text-xs text-muted-foreground">· {problemAttemptCount[problemId] || 0} attempts</span>
                  </div>
                  <span className="text-xs text-muted-foreground truncate ml-2 hidden sm:block">
                    {threadNotes[0]?.content?.slice(0, 60) || '...'}
                  </span>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
                    {problem && (
                      <div className="flex gap-1 flex-wrap mb-2">
                        {(problem.topics || []).map(t => (
                          <span key={t} className="text-xs px-2 py-0.5 bg-muted rounded-full">{t}</span>
                        ))}
                      </div>
                    )}
                    {threadNotes.map(note => (
                      <div key={note.id} className="group bg-muted/30 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm flex-1 whitespace-pre-wrap">{note.content}</p>
                          <button
                            onClick={() => handleDeleteNote(note.id)}
                            className="p-1 hover:bg-destructive/10 rounded opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{new Date(note.created_date).toLocaleString()}</p>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-2">
                      {problem && (
                        <Link to={`/problems?problem=${problemId}`} className="text-xs text-primary hover:underline">View problem in bank →</Link>
                      )}
                      <button
                        onClick={() => handleDeleteThread(problemId)}
                        className="text-xs text-destructive hover:underline"
                      >
                        Delete entire thread
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TopicGroup({ topic, notes, problemMap, onDeleteNote }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-accent/30"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="font-medium">{topic}</span>
          <span className="text-xs text-muted-foreground">({notes.length} notes)</span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
          {notes.map(note => {
            const problem = problemMap[note.problem_id];
            return (
              <div key={note.id} className="group bg-muted/30 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    {problem && (
                      <span className="text-xs font-mono text-muted-foreground block mb-1">
                        {problem.year}{problem.contest}-P{problem.number}
                      </span>
                    )}
                    <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(note.created_date).toLocaleString()}</p>
                  </div>
                  <button
                    onClick={() => onDeleteNote(note.id)}
                    className="p-1 hover:bg-destructive/10 rounded opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}