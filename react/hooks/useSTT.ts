'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export type STTState = 'idle' | 'listening' | 'processing' | 'error';
export type STTMode = 'browser' | 'server';

export interface UseSTTOptions {
  /** 'browser' uses Web Speech API (free, realtime). 'server' uses /api/stt (Deepgram, higher accuracy). */
  mode?: STTMode;
  /** API route for server-side STT. Defaults to '/api/stt' */
  sttRoute?: string;
  language?: string;
  /** Called when a final transcript is ready */
  onTranscript: (text: string) => void;
  /** Called with interim (partial) results in browser mode */
  onInterim?: (text: string) => void;
  /** Spacebar hotkey — toggles listen. Default true. */
  spacebarHotkey?: boolean;
}

export interface UseSTTResult {
  state: STTState;
  interimText: string;
  isSupported: boolean;
  micPermission: 'granted' | 'denied' | 'prompt';
  start: () => void;
  stop: () => void;
  toggle: () => void;
  error: string | null;
}

export function useSTT(options: UseSTTOptions): UseSTTResult {
  const {
    mode = 'browser',
    sttRoute = '/api/stt',
    language = 'en-US',
    onTranscript,
    onInterim,
    spacebarHotkey = true,
  } = options;

  const [state, setState] = useState<STTState>('idle');
  const [interimText, setInterimText] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const [micPermission, setMicPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const isListeningRef = useRef(false);

  useEffect(() => {
    // Check Web Speech API support
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (mode === 'browser' && !SR) setIsSupported(false);

    // Check mic permission
    if (navigator.permissions) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((result) => {
          setMicPermission(result.state as 'granted' | 'denied' | 'prompt');
          result.onchange = () =>
            setMicPermission(result.state as 'granted' | 'denied' | 'prompt');
        })
        .catch(() => {});
    }

    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spacebar hotkey
  useEffect(() => {
    if (!spacebarHotkey) return;
    const handle = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        isListeningRef.current ? stop() : start();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spacebarHotkey]);

  const start = useCallback(() => {
    if (isListeningRef.current) return;
    setError(null);

    if (mode === 'browser') {
      startBrowserSTT();
    } else {
      startServerSTT();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const stop = useCallback(() => {
    if (mode === 'browser') {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    } else {
      mediaRecorderRef.current?.stop();
    }
    isListeningRef.current = false;
    setState('idle');
    setInterimText('');
  }, [mode]);

  const toggle = useCallback(() => {
    isListeningRef.current ? stop() : start();
  }, [start, stop]);

  // ── Browser STT ──
  function startBrowserSTT() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) { setIsSupported(false); return; }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setState('listening');
      isListeningRef.current = true;
      setInterimText('');
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }
      if (interim) { setInterimText(interim); onInterim?.(interim); }
      if (final) {
        setInterimText('');
        onTranscript(final.trim());
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') setMicPermission('denied');
      setError(event.error);
      setState('error');
      isListeningRef.current = false;
    };

    recognition.onend = () => {
      setState('idle');
      isListeningRef.current = false;
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch (e) {
      setError(String(e));
      setState('error');
      isListeningRef.current = false;
    }
  }

  // ── Server STT (Deepgram) ──
  function startServerSTT() {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

        recorder.onstop = async () => {
          setState('processing');
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();

          try {
            const res = await fetch(sttRoute, {
              method: 'POST',
              headers: { 'Content-Type': 'audio/webm' },
              body: arrayBuffer,
            });
            if (!res.ok) throw new Error(`STT error ${res.status}`);
            const data = await res.json();
            if (data.transcript) onTranscript(data.transcript);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Transcription failed');
            setState('error');
          } finally {
            setState('idle');
            isListeningRef.current = false;
          }
        };

        recorder.start();
        setState('listening');
        isListeningRef.current = true;
      })
      .catch((err) => {
        if (err.name === 'NotAllowedError') setMicPermission('denied');
        setError(err.message);
        setState('error');
      });
  }

  return { state, interimText, isSupported, micPermission, start, stop, toggle, error };
}
