import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Trash2, Edit3, Check, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { correctTranscript } from '@/lib/mathTranscript';
import { base44 } from '@/api/base44Client';

// Voice note recorder using MediaRecorder → Groq Whisper → math correction.
// Replaces the Web Speech API for dramatically better math vocabulary accuracy.
export default function VoiceNoteRecorder({ notes = [], onChange, disabled = false }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [editingIdx, setEditingIdx] = useState(null);
  const [editText, setEditText] = useState('');
  const [recordingSupported, setRecordingSupported] = useState(true);
  const [dragCanceled, setDragCanceled] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const mimeTypeRef = useRef('audio/webm');
  const holdTimerRef = useRef(null);
  const elapsedTimerRef = useRef(null);
  const startTimeRef = useRef(0);
  const dragStartRef = useRef(null);
  const dragCanceledRef = useRef(false);

  useEffect(() => {
    setRecordingSupported(
      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)
    );
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
    }
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mimeTypeRef.current = mediaRecorder.mimeType || 'audio/webm';
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        // Clean up stream
        streamRef.current?.getTracks().forEach(t => t.stop());

        // Skip if drag-canceled
        if (dragCanceledRef.current) {
          setIsRecording(false);
          return;
        }

        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        if (blob.size === 0) {
          setIsRecording(false);
          return;
        }

        // Transcribe via Groq Whisper
        setIsTranscribing(true);
        setTranscribeError('');

        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64data = reader.result.split(',')[1];
          try {
            const res = await base44.functions.invoke('transcribeAudio', {
              audio: base64data,
              mimeType: mimeTypeRef.current,
            });
            if (res.data?.text) {
              const corrected = correctTranscript(res.data.text);
              onChange([...notes, { content: corrected, date: new Date().toISOString() }]);
            } else {
              setTranscribeError('Transcription failed. Type your note or try again.');
            }
          } catch {
            setTranscribeError('Transcription failed. Type your note or try again.');
          }
          setIsTranscribing(false);
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setElapsed(0);
      setTranscribeError('');
      startTimeRef.current = Date.now();
      elapsedTimerRef.current = setInterval(() => {
        setElapsed((Date.now() - startTimeRef.current) / 1000);
      }, 100);
    } catch {
      setRecordingSupported(false);
    }
  }, [notes, onChange]);

  const handleHoldStart = (e) => {
    if (disabled || !recordingSupported || isTranscribing) return;
    e.preventDefault();
    dragStartRef.current = { x: e.clientX || (e.touches && e.touches[0].clientX), y: e.clientY || (e.touches && e.touches[0].clientY) };
    setDragCanceled(false);
    dragCanceledRef.current = false;
    holdTimerRef.current = setTimeout(() => {
      startRecording();
    }, 300);
  };

  const handleHoldEnd = () => {
    if (disabled) return;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
    }
    if (isRecording) {
      stopRecording();
    }
    setDragCanceled(false);
    dragStartRef.current = null;
  };

  const handleMove = (e) => {
    if (!isRecording || !dragStartRef.current) return;
    const x = e.clientX || (e.touches && e.touches[0].clientX);
    const dx = Math.abs(x - dragStartRef.current.x);
    if (dx > 80) {
      setDragCanceled(true);
      dragCanceledRef.current = true;
      stopRecording();
    }
  };

  const handleEdit = (idx) => {
    setEditingIdx(idx);
    setEditText(notes[idx].content);
  };

  const handleSaveEdit = () => {
    if (editingIdx !== null) {
      const updated = [...notes];
      updated[editingIdx] = { ...updated[editingIdx], content: editText };
      onChange(updated);
      setEditingIdx(null);
    }
  };

  const handleDelete = (idx) => {
    onChange(notes.filter((_, i) => i !== idx));
  };

  const addTextNote = () => {
    const newNote = { content: '', date: new Date().toISOString() };
    onChange([...notes, newNote]);
    setEditingIdx(notes.length);
    setEditText('');
  };

  return (
    <div className={cn('space-y-3', disabled && 'opacity-50 pointer-events-none')}>
      {/* Hold-to-record pill */}
      <div className="flex items-center gap-3">
        <button
          onMouseDown={handleHoldStart}
          onMouseUp={handleHoldEnd}
          onMouseLeave={handleHoldEnd}
          onMouseMove={handleMove}
          onTouchStart={handleHoldStart}
          onTouchEnd={handleHoldEnd}
          onTouchMove={handleMove}
          disabled={disabled || !recordingSupported || isTranscribing}
          className={cn(
            'flex items-center gap-2 px-5 py-3 rounded-full font-medium text-sm transition-all select-none',
            isRecording
              ? 'bg-red-500 text-white scale-105'
              : isTranscribing
                ? 'bg-muted text-muted-foreground'
                : 'bg-primary text-primary-foreground hover:opacity-90',
            !recordingSupported && 'opacity-40 cursor-not-allowed'
          )}
        >
          {isRecording ? (
            <>
              <Mic className="w-4 h-4 animate-pulse" />
              Recording... {elapsed.toFixed(1)}s {dragCanceled ? '(canceling)' : ''}
            </>
          ) : isTranscribing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Transcribing...
            </>
          ) : recordingSupported ? (
            <>
              <Mic className="w-4 h-4" />
              Hold to record note
            </>
          ) : (
            'Voice not supported'
          )}
        </button>
        {!recordingSupported && (
          <button
            onClick={addTextNote}
            className="text-sm text-primary hover:underline"
          >
            + Add text note
          </button>
        )}
      </div>

      {/* Transcribing indicator */}
      {isTranscribing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-2 bg-muted rounded-lg">
          <Loader2 className="w-4 h-4 animate-spin" />
          Transcribing audio via Whisper...
        </div>
      )}

      {/* Error message */}
      {transcribeError && !isTranscribing && (
        <div className="flex items-center gap-2 text-sm text-destructive px-3 py-2 bg-destructive/10 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {transcribeError}
          <button onClick={addTextNote} className="ml-auto text-primary hover:underline text-xs whitespace-nowrap">
            Type instead
          </button>
        </div>
      )}

      {/* Note entries */}
      {notes.length > 0 && (
        <div className="space-y-2">
          {notes.map((note, idx) => (
            <div key={idx} className="bg-muted/50 rounded-lg p-3 group">
              {editingIdx === idx ? (
                <div className="space-y-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full bg-background border border-border rounded p-2 text-sm resize-y min-h-[60px]"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button onClick={handleSaveEdit} className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <Check className="w-3 h-3" /> Save
                    </button>
                    <button onClick={() => setEditingIdx(null)} className="text-xs text-muted-foreground hover:underline">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm flex-1">{note.content || '(empty — tap edit to add text)'}</p>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEdit(idx)} className="p-1 hover:bg-accent rounded">
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button onClick={() => handleDelete(idx)} className="p-1 hover:bg-accent rounded">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}