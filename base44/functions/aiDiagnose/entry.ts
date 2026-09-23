import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';
import { callGroq } from '../../shared/groqClient.ts';

// AI Diagnosis: three-tier fallback (platform AI → Groq (multi-key rotation) → rule-based)
// Compares transcribed reasoning against the problem and official solution.

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    diagnosis: { type: 'string', description: 'Concrete evidence-based point of divergence' },
    error_class: { type: 'string', enum: ['recognition', 'execution', 'conceptual', 'transfer', 'pacing', 'none'] },
    secondary_errors: { type: 'array', items: { type: 'string' } },
    transferable_lesson: { type: 'string', description: 'Short generalizable takeaway' },
  },
  required: ['diagnosis', 'error_class', 'transferable_lesson'],
};

function buildPrompt(problem, chosenAnswer, reasoning) {
  const solutionText = (problem.solution_steps || []).join('\n\n');
  return `You are an expert AMC 12 math tutor analyzing a student's attempt.

PROBLEM:
${problem.question}

CORRECT ANSWER: ${problem.answer}
STUDENT'S ANSWER: ${chosenAnswer || '(blank/skipped)'}
STUDENT'S REASONING (transcribed voice notes):
${reasoning || '(no reasoning provided)'}

OFFICIAL SOLUTION:
${solutionText}

Analyze the student's reasoning against the official solution. Identify the CONCRETE point of divergence — cite what the student said or didn't say. Do NOT restate the full solution. Classify the primary error type:
- recognition: failed to identify the problem type or key structure
- execution: identified the right approach but made a computational or algebraic error
- conceptual: fundamental misunderstanding of the underlying concept
- transfer: knew the method but failed to apply it in this specific context
- pacing: ran out of time or rushed
- none: correct answer, no error

Respond as JSON with: diagnosis (evidence-based), error_class, secondary_errors (array), transferable_lesson (short, generalizable).`;
}

async function tryPlatformAI(base44, prompt) {
  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: RESPONSE_SCHEMA,
    });
    if (result && result.diagnosis) {
      return { ...result, ai_tier: 'platform' };
    }
    return null;
  } catch {
    return null;
  }
}

async function tryGroq(prompt) {
  const res = await callGroq(prompt, { temperature: 0.3, maxTokens: 1000 });
  if (!res) return null;
  return { ...res.parsed, ai_tier: 'groq' };
}

function ruleBasedFallback(problem, chosenAnswer, reasoning) {
  const isCorrect = chosenAnswer === problem.answer;
  if (isCorrect) {
    return {
      diagnosis: reasoning
        ? `Your reasoning led to the correct answer (${chosenAnswer}). The approach appears sound based on your transcript.`
        : `Correct answer (${chosenAnswer}) with no recorded reasoning.`,
      error_class: 'none',
      secondary_errors: [],
      transferable_lesson: 'Confirm this approach is generalizable to similar problems.',
      ai_tier: 'rule_based',
    };
  }
  if (!chosenAnswer || chosenAnswer === '') {
    return {
      diagnosis: reasoning
        ? `You skipped this problem. Your transcript shows: "${reasoning.slice(0, 200)}..." — the reasoning was incomplete or you were unable to commit to an approach.`
        : 'You skipped this problem without recording reasoning. The primary gap is in committing to a first move.',
      error_class: 'recognition',
      secondary_errors: ['pacing'],
      transferable_lesson: 'Even when uncertain, commit to a first move and execute — a partial attempt reveals where the gap is.',
      ai_tier: 'rule_based',
    };
  }
  return {
    diagnosis: reasoning
      ? `You chose ${chosenAnswer} but the correct answer is ${problem.answer}. Your transcript shows: "${reasoning.slice(0, 300)}..." — compare this against the official solution to find where the reasoning diverged.`
      : `You chose ${chosenAnswer} but the correct answer is ${problem.answer}. No reasoning was recorded, so the specific point of divergence cannot be identified. The error is likely in recognition or execution.`,
    error_class: 'execution',
    secondary_errors: [],
    transferable_lesson: 'Review the official solution and identify the exact step where your approach differed.',
    ai_tier: 'rule_based',
  };
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { problem_id, chosen_answer, reasoning } = body;

    if (!problem_id) return Response.json({ error: 'problem_id required' }, { status: 400 });

    // Fetch the problem (service role to bypass RLS for read)
    const problems = await base44.asServiceRole.entities.Problem.filter({ problem_id });
    const problem = problems[0];
    if (!problem) return Response.json({ error: 'Problem not found' }, { status: 404 });

    // Skip AI tiers entirely when no reasoning was recorded — saves credits
    // and the rule-based fallback already handles these cases well.
    const hasReasoning = reasoning && reasoning.trim().length > 0;

    let result = null;
    if (hasReasoning) {
      const prompt = buildPrompt(problem, chosen_answer, reasoning);

      // Tier 1: Platform AI
      result = await tryPlatformAI(base44, prompt);

      // Tier 2: Groq
      if (!result) {
        result = await tryGroq(prompt);
      }
    }

    // Tier 3: Rule-based fallback (always used when no reasoning or AI fails)
    if (!result) {
      result = ruleBasedFallback(problem, chosen_answer, reasoning);
    }

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}