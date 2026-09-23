import React from 'react';
import { Image, ExternalLink } from 'lucide-react';

// AoPS Wiki URL for a specific AMC 12 problem, e.g.
// https://artofproblemsolving.com/wiki/index.php/2002_AMC_12A_Problems/Problem_5
function aopsUrl(problem) {
  return `https://artofproblemsolving.com/wiki/index.php/${problem.year}_AMC_12${problem.contest}_Problems/Problem_${problem.number}`;
}

export default function DiagramNotice({ problem }) {
  if (!problem) return null;
  // Show if the problem has a diagram flag OR references a figure/diagram in text
  // (some problems reference "the figure" or "shown below" but lack Image:/File: markers)
  const textRef = /(?:the figure|the diagram|shown below)/i.test(problem.question || '');
  if (!problem.has_diagram && !textRef) return null;
  return (
    <div className="flex items-center gap-2 mb-3 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
      <Image className="w-3.5 h-3.5 flex-shrink-0" />
      <span>
        This problem references a figure from the original contest that is not shown.{' '}
        <a
          href={aopsUrl(problem)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline underline-offset-2 inline-flex items-center gap-0.5 hover:text-amber-700 dark:hover:text-amber-300"
        >
          View it on AoPS <ExternalLink className="w-3 h-3" />
        </a>
      </span>
    </div>
  );
}