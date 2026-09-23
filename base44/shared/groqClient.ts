import { secrets } from 'base44:runtime';

// Shared Groq client with multi-key rotation.
// Tries GROQ_API_KEY → GROQ_API_KEY_2 → _3 → _4 in order; first key that
// returns a valid parsed JSON response wins. Any non-200 (incl. 401/402/403/429/5xx)
// or parse error rotates to the next key. Returns null if all keys fail.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';
const KEY_NAMES = ['GROQ_API_KEY', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3', 'GROQ_API_KEY_4'];
const TIMEOUT_MS = 15000;

export async function callGroq(prompt, opts = {}) {
  const {
    systemPrompt = 'You are an expert AMC 12 math tutor. Respond only with valid JSON.',
    temperature = 0.3,
    maxTokens = 1000,
    responseFormatJson = true,
  } = opts;

  for (const keyName of KEY_NAMES) {
    const apiKey = secrets.get(keyName);
    if (!apiKey) continue;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          response_format: responseFormatJson ? { type: 'json_object' } : undefined,
          temperature,
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) continue;
      const parsed = JSON.parse(content);
      return { parsed, raw: content };
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

// Groq Whisper audio transcription with multi-key rotation.
// Sends an audio Blob to Groq's Whisper endpoint and returns the transcribed
// text, or null if all keys fail. A math-vocabulary prompt biases the model
// toward recognizing terms like "co-tangent", "radii", "theta", etc.
const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_WHISPER_MODEL = 'whisper-large-v3';
const TRANSCRIPTION_TIMEOUT_MS = 30000;
const MATH_PROMPT = 'A student explains a math solution using terms like: pi, sine, cosine, tangent, theta, radius, radii, co-tangent, Pythagorean theorem, polynomial, coefficient, derivative, integral, hypotenuse, isosceles, perpendicular, logarithm, factorial, quadratic, asymptote, matrix, vector, numerator, denominator, arcsin, arccos, arctan, secant, cosecant, cotangent, equilateral, circumference, diameter, exponent, gcd, lcm, ln, natural log, square root, absolute value, modulus, binomial, sequence, series, domain, range, vertex, chord, arc, acute, obtuse, congruent, similar, maximum, minimum, inflection, limit, epsilon, lambda, sigma, alpha, beta, gamma, delta, phi, omega.';

export async function transcribeGroq(audioBlob, opts = {}) {
  const { language = 'en', temperature = 0, prompt = MATH_PROMPT } = opts;

  for (const keyName of KEY_NAMES) {
    const apiKey = secrets.get(keyName);
    if (!apiKey) continue;

    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', GROQ_WHISPER_MODEL);
    formData.append('language', language);
    formData.append('temperature', String(temperature));
    formData.append('response_format', 'json');
    if (prompt) formData.append('prompt', prompt);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);
    try {
      const res = await fetch(GROQ_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.text) return data.text;
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}