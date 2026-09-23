import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';
import { callGroq } from '../../shared/groqClient.ts';

// AI Hint generation: progressive 2-4 level ladder that never reveals the answer.
// Returns all levels at once; client reveals them progressively and caches.

async function tryPlatformAI(base44, prompt) {
  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          hints: {
            type: 'array',
            items: { type: 'string' },
            description: '2-4 progressive hints, from alternate representation to key idea, never revealing the answer',
          },
        },
        required: ['hints'],
      },
    });
    if (result && result.hints && result.hints.length > 0) {
      return { hints: result.hints, ai_tier: 'platform' };
    }
    return null;
  } catch {
    return null;
  }
}

async function tryGroq(prompt) {
  const res = await callGroq(prompt, { temperature: 0.4, maxTokens: 800 });
  if (!res || !res.parsed.hints || res.parsed.hints.length === 0) return null;
  return { hints: res.parsed.hints, ai_tier: 'groq' };
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { problem_id } = body;
    if (!problem_id) return Response.json({ error: 'problem_id required' }, { status: 400 });

    const problems = await base44.asServiceRole.entities.Problem.filter({ problem_id });
    const problem = problems[0];
    if (!problem) return Response.json({ error: 'Problem not found' }, { status: 404 });

    const prompt = `You are an expert AMC 12 tutor. Generate a progressive hint ladder (2-4 levels) for this problem.

PROBLEM:
${problem.question}

The hints must:
- Level 1: Suggest an alternate representation or way to look at the problem
- Level 2: A nudge toward the right approach
- Level 3: A structural hint about the key relationship
- Level 4 (if needed): The key idea, stated without revealing the answer

NEVER reveal the answer or which choice (A-E) is correct.
Keep each hint to 1-2 sentences.

Respond as JSON: { "hints": ["hint1", "hint2", ...] }`;

    let result = await tryPlatformAI(base44, prompt);
    if (!result) result = await tryGroq(prompt);

    if (!result) {
      // Rule-based fallback: generic progressive hints grounded in the problem
      result = {
        hints: [
          'Try restating the problem in your own words — what is being asked and what information is given?',
          'Consider what mathematical structure or tool naturally applies to this type of problem.',
          'Look for a key relationship between the quantities mentioned in the problem.',
        ],
        ai_tier: 'rule_based',
      };
    }

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}