import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';
import { transcribeGroq } from '../../shared/groqClient.ts';

// Transcribes audio via Groq Whisper (whisper-large-v3) with multi-key rotation.
// Receives base64-encoded audio in JSON, converts to Blob, sends to Groq.
// Returns { text } on success, { error } on failure.

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { audio, mimeType } = body;

    if (!audio) return Response.json({ error: 'audio required' }, { status: 400 });

    // Convert base64 to Blob
    const audioBytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
    const audioBlob = new Blob([audioBytes], { type: mimeType || 'audio/webm' });

    // Transcribe via Groq Whisper with key rotation
    const text = await transcribeGroq(audioBlob);

    if (!text) {
      return Response.json({ error: 'Transcription failed — all keys exhausted' }, { status: 503 });
    }

    return Response.json({ text });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}