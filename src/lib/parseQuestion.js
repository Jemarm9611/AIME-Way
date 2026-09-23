// Extract answer choices from AMC question text.
// Questions typically embed choices as: \textbf{(A)} val \qquad \textbf{(B)} val ...
// or: \mathrm{(A) \ } val \qquad \mathrm{(B) \ } val ...
// These may or may not be wrapped in $...$ delimiters.
// Returns { statement: "question without choices", choices: { A: "val", ... } }

// Label token: a \command (textbf/textrm/mathrm/text) followed by {(A)}.
// Handles both `\mathrm{(A) \ 48 }` (value inside braces) and `\textbf{(A)}\ 0` (value outside).
const LABEL_RE = /\\(?:textbf|textrm|mathrm|text)\s*\{\s*\(([A-E])\)/g;
// Style-6 markers wrap the command in parens: (\mathrm {A}) — normalize to \mathrm{(A)}
const PAREN_WRAPPED_RE = /\(\s*\\(?:textbf|textrm|mathrm|text)\s*\{\s*([A-E])\s*\}\s*\)/g;

// Decode HTML entities in text (e.g. &#36; → $, &lt; → <)
export function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Convert MediaWiki markup to inline LaTeX for KaTeX rendering
// '''text''' → $\textbf{text}$, ''text'' → $\textit{text}$
export function convertWikiMarkup(text) {
  if (!text) return '';
  let result = text.replace(/'''([^']+)'''/g, '$\\textbf{$1}$');
  result = result.replace(/''([^']+)''/g, '$\\textit{$1}$');
  return result;
}

// Clean a single choice value: strip leading LaTeX spacing (\ , \,, \;, \!, \:)
// and trailing separators (\qquad, \quad, \hspace{...}). Spacing commands are
// removed BEFORE trimming so that "\ " (backslash + space) is recognized as a
// unit — otherwise trim() collapses it to a lone "\" that no longer matches.
function cleanChoiceValue(v) {
  let val = v;
  val = val.replace(/^(\\\s|\\,|\\;|\\!|\\:|\s)+/, '');
  val = val.replace(/(\\qquad|\\quad|\\hspace\{[^}]*\}|\\\s|\\,|\\;|\\!|\\:|\s)+$/, '');
  return val.trim();
}

// Find the brace that closes the choice group opened before (A), balancing nested braces.
function findClosingBrace(text, start) {
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth === 0) return i;
    i++;
  }
  return -1;
}

export function parseQuestionChoices(rawQuestion) {
  if (!rawQuestion) return { statement: '', choices: {} };

  let cleaned = decodeHtmlEntities(rawQuestion);
  cleaned = convertWikiMarkup(cleaned);

  // Normalize paren-wrapped markers (\mathrm {A}) → \mathrm{(A)} so every choice
  // shares the \command{(A)…} shape.
  cleaned = cleaned.replace(PAREN_WRAPPED_RE, (_, letter) => `\\mathrm{(${letter})}`);

  // Locate every choice label.
  const labels = [];
  let m;
  LABEL_RE.lastIndex = 0;
  while ((m = LABEL_RE.exec(cleaned)) !== null) {
    labels.push({ letter: m[1], valueStart: m.index + m[0].length, tokenStart: m.index });
  }

  if (labels.length === 0) return { statement: cleaned.trim(), choices: {} };

  // Statement is everything before the first label.
  let statement = cleaned.slice(0, labels[0].tokenStart);
  const dollarCount = (statement.match(/\$/g) || []).length;
  // If the statement ends with an unbalanced $ (the opening of the choices math
  // block), drop it; otherwise leave $ pairs intact.
  if (dollarCount % 2 === 1) {
    statement = statement.replace(/\s*\$\s*$/, '').trim();
  } else {
    statement = statement.trim();
  }

  const choices = {};
  for (let i = 0; i < labels.length; i++) {
    const lbl = labels[i];
    const closeIdx = findClosingBrace(cleaned, lbl.valueStart);
    if (closeIdx === -1) continue;

    // Value may live inside the braces (\mathrm{(A) \ 48 }) or outside them
    // (\textbf{(A)}\ 0). Prefer the inside content; fall back to the text
    // between this token and the next label.
    let val = cleanChoiceValue(cleaned.slice(lbl.valueStart, closeIdx));
    if (!val) {
      const segStart = closeIdx + 1;
      const segEnd = i + 1 < labels.length ? labels[i + 1].tokenStart : cleaned.length;
      let between = cleaned.slice(segStart, segEnd).replace(/^\$+/, '').replace(/\$+$/, '').trim();
      val = cleanChoiceValue(between);
    }
    if (val) choices[lbl.letter] = val;
  }

  return { statement, choices };
}

// Wrap a choice value in $...$ if it contains LaTeX commands, braces, or math operators.
// If the value already contains $ delimiters, return as-is — MathText will tokenize
// and render the math portions correctly. Wrapping again would put prose inside math
// mode, collapsing spaces (e.g. "counterclockwise rotation ... by $90^\circ$" → broken).
export function wrapMath(value) {
  if (!value) return '';
  if (value.includes('$')) return value;
  if (value.includes('\\') || value.includes('{') || value.includes('}') || /[<>]/.test(value)) {
    return `$${value}$`;
  }
  return value;
}