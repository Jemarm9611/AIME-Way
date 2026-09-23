import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { decodeHtmlEntities, convertWikiMarkup } from '@/lib/parseQuestion';

// Strip Asymptote code blocks, image/file references, and HTML comments
function cleanRawText(text) {
  if (!text) return '';
  let cleaned = text;
  // Decode HTML entities first (so &#36; → $ for math detection)
  cleaned = decodeHtmlEntities(cleaned);
  // Convert MediaWiki markup ('''bold''', ''italic'') to inline LaTeX
  cleaned = convertWikiMarkup(cleaned);
  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
  // Remove Asymptote code blocks ```asy ... ```
  cleaned = cleaned.replace(/```asy[\s\S]*?```/g, '');
  // Remove generic code blocks that contain drawing commands
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (m) => {
    if (/unitsize|draw|fill|label|circle|arc|dot|path|import|size|defaultpen|currentprojection/i.test(m)) return '';
    return m;
  });
  // Remove Image:/File: references
  cleaned = cleaned.replace(/Image:[^\s)]+/g, '');
  cleaned = cleaned.replace(/File:[^\s)]+/g, '');
  // Remove standalone "right", "center" diagram placement markers
  cleaned = cleaned.replace(/^\s*(right|center)\s*$/gm, '');
  // Remove <center> tags
  cleaned = cleaned.replace(/<\/?center>/g, '');
  return cleaned;
}

// Repair common mangled LaTeX
function repairLatex(text) {
  if (!text) return '';
  let repaired = text;
  // Fix common encoding issues
  repaired = repaired.replace(/â€™/g, "'").replace(/â€œ/g, '"').replace(/â€/g, '"');
  repaired = repaired.replace(/Ã¢/g, '');
  // Fix broken \frac that got split
  repaired = repaired.replace(/\\frac\s*\{/g, '\\frac{');
  // Replace \overarc / \widearc (not supported by KaTeX) with \overset{\frown}{...}
  repaired = repaired.replace(/\\(?:overarc|widearc)\{([^}]+)\}/g, '\\overset{\\frown}{$1}');
  return repaired;
}

// Tokenize text into math and prose segments
function tokenize(text) {
  const segments = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    // Display math $$...$$
    if (text[i] === '$' && text[i + 1] === '$') {
      const end = text.indexOf('$$', i + 2);
      if (end !== -1) {
        segments.push({ type: 'display', content: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    // Inline math $...$  (skip escaped \$)
    if (text[i] === '$' && text[i - 1] !== '\\') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '$' && text[j - 1] !== '\\') break;
        j++;
      }
      if (j < n) {
        segments.push({ type: 'inline', content: text.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    // Prose — accumulate until next unescaped $
    let j = i;
    while (j < n) {
      if (text[j] === '$' && text[j - 1] !== '\\') break;
      j++;
    }
    if (j > i) {
      segments.push({ type: 'prose', content: text.slice(i, j) });
      i = j;
    } else {
      i++;
    }
  }
  return segments;
}

function renderMath(latex, displayMode) {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'html',
    });
  } catch {
    return `<span class="text-destructive">${latex}</span>`;
  }
}

// Main shared renderer used everywhere math appears
export default function MathText({ content, className = '', block = false }) {
  const cleaned = cleanRawText(repairLatex(content || ''));
  const segments = tokenize(cleaned);

  return (
    <span
      className={className}
      style={{ lineHeight: '1.8' }}
    >
      {segments.map((seg, idx) => {
        if (seg.type === 'prose') {
          // Restore escaped \$ to literal $ in prose
          const prose = seg.content.replace(/\\\$/g, '$');
          return (
            <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>
              {prose}
            </span>
          );
        }
        return (
          <span
            key={idx}
            className={seg.type === 'display' ? 'block my-3 overflow-x-auto' : 'inline'}
            dangerouslySetInnerHTML={{ __html: renderMath(seg.content, seg.type === 'display') }}
          />
        );
      })}
    </span>
  );
}

// Render solution steps as numbered, generously spaced, large-text steps
export function SolutionSteps({ steps, className = '' }) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className={className}>
      {steps.map((step, idx) => (
        <div
          key={idx}
          className="flex gap-3 mb-5 text-lg leading-relaxed"
        >
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold mt-0.5">
            {idx + 1}
          </span>
          <div className="flex-1">
            <MathText content={step} block />
          </div>
        </div>
      ))}
    </div>
  );
}