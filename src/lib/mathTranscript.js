// Comprehensive math speech-to-text processing — fully client-side, no credits.
//
// correctTranscript:     fixes known misrecognitions → correct notation
// pickBestAlternative:   selects the most math-likely from speech recognition alternatives
// buildMathGrammar:      creates a SpeechGrammarList to bias Chrome's recognizer

// === Correction list (misrecognition → correct notation) ===
// Sorted by key length at runtime so multi-word phrases match first.
const CORRECTIONS = [
  // === Inequality / equality notation ===
  ['less than or equal to', '≤'],
  ['greater than or equal to', '≥'],
  ['not equal to', '≠'],
  ['is equal to', '='],
  ['approximately', '≈'],

  // === Multi-word math terms (misrecognitions + notation) ===
  ['square route', 'square root'],
  ['square rooted', 'square root'],
  ['inverse sine', 'arcsin'],
  ['inverse cosine', 'arccos'],
  ['inverse tangent', 'arctan'],
  ['natural log', 'ln'],
  ['log rhythm', 'logarithm'],
  ['co tangent', 'cot'],
  ['co-tangent', 'cot'],
  ['co sign', 'cos'],
  ['co-sign', 'cos'],
  ['high pot in use', 'hypotenuse'],
  ['pie thagorean', 'Pythagorean'],
  ['py thagorean', 'Pythagorean'],
  ['co efficient', 'coefficient'],
  ['co-efficient', 'coefficient'],
  ['poly no meal', 'polynomial'],
  ['poly nominal', 'polynomial'],
  ['greatest common divisor', 'gcd'],
  ['least common multiple', 'lcm'],
  ['tangent of', 'tan of'],

  // === Single-word corrections ===
  ['pie', 'pi'],
  ['sine', 'sin'],
  ['cosign', 'cos'],
  ['cosine', 'cos'],
  ['secant', 'sec'],
  ['cosecant', 'csc'],
  ['cage', 'page'],
  ['some', 'sum'],
  ['hippotenuse', 'hypotenuse'],
  ['hipotenuse', 'hypotenuse'],
  ['ice osceles', 'isosceles'],
  ['i sosceles', 'isosceles'],
];

// === Math vocabulary for alternative scoring ===
// Terms that, if present in a recognition alternative, indicate math content.
// Includes both correct terms and known misrecognitions (either signals math).
const MATH_VOCABULARY = new Set([
  // Greek letters — very strong math signal
  'theta', 'alpha', 'beta', 'gamma', 'delta', 'lambda', 'mu', 'sigma',
  'phi', 'omega', 'epsilon', 'rho', 'tau', 'psi', 'chi', 'xi', 'zeta',
  'nu', 'kappa', 'iota', 'eta', 'upsilon',
  // Trig functions
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'sine', 'cosine', 'tangent', 'secant', 'cosecant', 'cotangent',
  'arcsin', 'arccos', 'arctan',
  // Constants / notation
  'pi', 'ln', 'log', 'logarithm', 'gcd', 'lcm',
  // Calculus
  'derivative', 'integral', 'asymptote', 'inflection',
  // Algebra
  'polynomial', 'coefficient', 'binomial', 'trinomial',
  'quadratic', 'cubic', 'quartic', 'quintic',
  'numerator', 'denominator', 'modulus',
  // Geometry
  'hypotenuse', 'isosceles', 'equilateral', 'scalene',
  'pythagorean', 'perpendicular', 'circumference',
  'radius', 'diameter',
  // Linear algebra
  'matrix', 'vector', 'determinant',
  // Combinatorics
  'factorial', 'permutation', 'combination',
  // Known misrecognitions (still indicate math intent)
  'pie',
]);

// Multi-word math phrases (checked via substring for scoring)
const MATH_PHRASES = [
  'square root', 'cube root',
  'natural log', 'log base',
  'absolute value',
  'less than or equal', 'greater than or equal',
  'inverse sine', 'inverse cosine', 'inverse tangent',
  'pythagorean theorem',
  'perpendicular bisector',
  'greatest common divisor', 'least common multiple',
  'power of', 'raised to',
  'area of', 'volume of',
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function correctTranscript(text) {
  if (!text) return '';
  let corrected = text;
  const sorted = [...CORRECTIONS].sort((a, b) => b[0].length - a[0].length);
  for (const [wrong, right] of sorted) {
    const regex = new RegExp(`\\b${escapeRegex(wrong)}\\b`, 'gi');
    corrected = corrected.replace(regex, right);
  }
  return corrected;
}

// Score how math-like a text is — used to rank recognition alternatives.
// Each math word adds 0.15; each multi-word phrase adds 0.25.
function scoreMathContent(text) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const phrase of MATH_PHRASES) {
    if (lower.includes(phrase)) score += 0.25;
  }
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (MATH_VOCABULARY.has(word)) score += 0.15;
  }
  return score;
}

// Pick the best alternative from speech recognition results.
// Balances recognizer confidence with math vocabulary density so that
// an alternative containing "theta" beats one where the recognizer
// heard "data" with higher raw confidence.
export function pickBestAlternative(alternatives) {
  if (!alternatives || alternatives.length === 0) return '';
  if (alternatives.length === 1) return alternatives[0].transcript || '';

  let best = alternatives[0];
  let bestScore = (best.confidence || 0.5) + scoreMathContent(best.transcript);

  for (let i = 1; i < alternatives.length; i++) {
    const alt = alternatives[i];
    const score = (alt.confidence || 0.5) + scoreMathContent(alt.transcript);
    if (score > bestScore) {
      best = alt;
      bestScore = score;
    }
  }
  return best.transcript || '';
}

// Build a SpeechGrammarList to bias Chrome's recognizer toward math terms.
// Returns null if not supported (progressive enhancement, Chrome-only).
export function buildMathGrammar() {
  if (typeof window === 'undefined') return null;
  const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;
  if (!SpeechGrammarList) return null;

  const terms = [...MATH_VOCABULARY]
    .filter(t => /^[a-z]+$/i.test(t))
    .join(' | ');
  const grammar = `#JSGF V1.0; grammar math; public <math> = ${terms};`;

  try {
    const list = new SpeechGrammarList();
    list.addFromString(grammar, 1);
    return list;
  } catch {
    return null;
  }
}