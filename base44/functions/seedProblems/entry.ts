import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';

// Seeds the Problem bank from two attached source files:
// 1. Info.txt (JSONL): question, answer, coarse difficulty, problem_id "2002A-P1"
// 2. amc12_poshenloh JSON (array): problem_id "2002A12-01", difficulty rating, solution
// Matches by (year, contest, number), filters to 2002-2019, strips diagrams, splits solutions.

const INFO_URL = 'https://media.base44.com/files/public/user_6ab2c33f3127b82894a47bd4/c2a399a9a_Info.txt';
const JSON_URL = 'https://media.base44.com/files/public/user_6ab2c33f3127b82894a47bd4/efcd8e7b0_amc12_poshenloh_2002_2022.json';

function bandFromRating(rating) {
  if (rating < 1330) return 'Easy';
  if (rating <= 1630) return 'Medium';
  if (rating <= 1990) return 'Hard';
  return 'Brutal';
}

// Parse "2002A-P1" -> { year: 2002, contest: "A", number: 1 }
function parseInfoId(id) {
  const m = id.match(/^(\d{4})([AB])-P(\d+)$/);
  if (!m) return null;
  return { year: parseInt(m[1]), contest: m[2], number: parseInt(m[3]) };
}

// Parse "2002A12-01" -> { year: 2002, contest: "A", number: 1 }
function parseJsonId(id) {
  const m = id.match(/^(\d{4})([AB])12-(\d+)$/);
  if (!m) return null;
  return { year: parseInt(m[1]), contest: m[2], number: parseInt(m[3]) };
}

// Topic classification — deterministic keyword rules
const TOPIC_RULES = [
  { topic: 'Algebra', keywords: ['polynomial', 'equation', 'quadratic', 'factor', 'root', 'function', 'f(x)', 'sequence', 'arithmetic', 'geometric', 'log', 'exponent', 'complex'] },
  { topic: 'Number Theory', keywords: ['prime', 'divisor', 'divisible', 'gcd', 'lcm', 'remainder', 'congruen', 'digit', 'base-', 'modular', 'palindrome'] },
  { topic: 'Combinatorics', keywords: ['probability', 'random', 'dice', 'coin', 'permutation', 'combination', 'binom', 'arrangement', 'how many', 'count'] },
  { topic: 'Geometry', keywords: ['triangle', 'circle', 'tangent', 'polygon', 'pentagon', 'hexagon', 'square', 'rectangle', 'cube', 'sphere', 'cone', 'cylinder', 'pyramid', 'angle', 'area', 'volume', 'coordinate', 'parabola', 'ellipse'] },
  { topic: 'Trigonometry', keywords: ['\\sin', '\\cos', '\\tan', 'trig', 'radian', 'law of cosines', 'law of sines'] },
];

function classifyTopics(question) {
  const lower = question.toLowerCase();
  const found = new Set();
  for (const rule of TOPIC_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        found.add(rule.topic);
        break;
      }
    }
  }
  return found.size > 0 ? [...found] : ['Uncategorized'];
}

// Strip Asymptote code blocks and image references from question text
function cleanQuestion(text) {
  let cleaned = text;
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
  cleaned = cleaned.replace(/```asy[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (m) => {
    if (/unitsize|draw|fill|label|circle|arc|dot|path|import|size/i.test(m)) return '';
    return m;
  });
  cleaned = cleaned.replace(/Image:[^\s)]+/g, '');
  cleaned = cleaned.replace(/File:[^\s)]+/g, '');
  cleaned = cleaned.replace(/^\s*(right|center)\s*$/gm, '');
  cleaned = cleaned.replace(/<\/?center>/g, '');
  // Fix encoding
  cleaned = cleaned.replace(/â€™/g, "'").replace(/â€œ/g, '"').replace(/â€/g, '"').replace(/Ã¢/g, '');
  return cleaned.trim();
}

// Split solution into logical steps on paragraph breaks
function splitSolutionSteps(solution) {
  if (!solution) return [];
  // Fix encoding
  let sol = solution.replace(/â€™/g, "'").replace(/â€œ/g, '"').replace(/â€/g, '"').replace(/Ã¢/g, '');
  // Split on double newlines (paragraph breaks)
  let parts = sol.split(/\n\n+/).map(s => s.trim()).filter(s => s.length > 0);
  // If only one big block, try splitting on single newlines that look like logical breaks
  if (parts.length <= 1) {
    parts = sol.split(/\n/).map(s => s.trim()).filter(s => s.length > 0);
  }
  // Further split very long steps (>600 chars) on sentence boundaries
  const result = [];
  for (const part of parts) {
    if (part.length > 600) {
      const sentences = part.split(/(?<=[.!?])\s+(?=[A-Z$\\])/);
      let current = '';
      for (const s of sentences) {
        if ((current + ' ' + s).length > 500 && current) {
          result.push(current.trim());
          current = s;
        } else {
          current = (current + ' ' + s).trim();
        }
      }
      if (current) result.push(current);
    } else {
      result.push(part);
    }
  }
  return result;
}

function hasUnrenderableDiagram(question) {
  // Problem depends entirely on a diagram if after cleaning there's almost no text
  const cleaned = cleanQuestion(question);
  const textOnly = cleaned.replace(/\$[^$]*\$/g, '').replace(/[A-E]\b/g, '').trim();
  return textOnly.length < 20;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    // Fetch both files
    const [infoRes, jsonRes] = await Promise.all([
      fetch(INFO_URL),
      fetch(JSON_URL),
    ]);
    const infoText = await infoRes.text();
    const jsonData = await jsonRes.json();

    // Build map from JSON file: (year,contest,number) -> { difficulty, solution }
    const jsonMap = {};
    for (const item of jsonData) {
      const parsed = parseJsonId(item.problem_id);
      if (!parsed) continue;
      const key = `${parsed.year}-${parsed.contest}-${parsed.number}`;
      jsonMap[key] = item;
    }

    // Parse Info.txt (JSONL)
    const infoLines = infoText.trim().split('\n').filter(l => l.trim());
    const problems = [];
    let skipped = 0;

    for (const line of infoLines) {
      try {
        const item = JSON.parse(line);
        const parsed = parseInfoId(item.problem_id);
        if (!parsed) { skipped++; continue; }
        // Filter to 2002-2019
        if (parsed.year < 2002 || parsed.year > 2019) { skipped++; continue; }

        const key = `${parsed.year}-${parsed.contest}-${parsed.number}`;
        const jsonMatch = jsonMap[key];
        if (!jsonMatch) { skipped++; continue; }

        const cleanedQuestion = cleanQuestion(item.question);
        if (hasUnrenderableDiagram(item.question)) { skipped++; continue; }

        const difficultyRating = jsonMatch.difficulty || 1000;
        const band = bandFromRating(difficultyRating);
        const solutionSteps = splitSolutionSteps(jsonMatch.solution || '');
        const topics = classifyTopics(item.question);
        const hasDiagram = /```asy|Image:|File:|the figure|the diagram|shown below/i.test(item.question);

        problems.push({
          problem_id: item.problem_id,
          year: parsed.year,
          contest: parsed.contest,
          number: parsed.number,
          question: cleanedQuestion,
          answer: item.answer,
          difficulty_rating: difficultyRating,
          band,
          solution_steps: solutionSteps,
          topics,
          has_diagram: hasDiagram,
        });
      } catch {
        skipped++;
      }
    }

    // Clear existing problems (service role)
    const existing = await base44.asServiceRole.entities.Problem.list('-created_date', 1000);
    if (existing.length > 0) {
      await base44.asServiceRole.entities.Problem.deleteMany({});
    }

    // Bulk create in batches of 400
    let created = 0;
    for (let i = 0; i < problems.length; i += 400) {
      const batch = problems.slice(i, i + 400);
      await base44.asServiceRole.entities.Problem.bulkCreate(batch);
      created += batch.length;
    }

    return Response.json({
      status: 'success',
      created,
      skipped,
      total_lines: infoLines.length,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}