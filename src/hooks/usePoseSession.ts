import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraError, startCamera, stopCamera } from '../cv/camera';
import { drawPose } from '../cv/drawPose';
import type { CvExerciseConfig } from '../cv/exercises/types';
import { FrameProcessor, type ProcessedFrame } from '../cv/frameProcessor';
import { createPoseDetector, POSE_CONNECTIONS, type PoseDetector } from '../cv/poseDetector';
import type { CvRepEvent } from '../cv/formCheck';

export type SessionStatus = 'idle' | 'starting' | 'running' | 'error';

export interface SessionSnapshot {
  frame: ProcessedFrame | null;
  lastEvent: CvRepEvent | null;
  fps: number;
}

/** React state is refreshed at most this often; drawing still happens every frame. */
const UI_UPDATE_INTERVAL_MS = 100;

export function usePoseSession(exercise: CvExerciseConfig) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<PoseDetector | null>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const processorRef = useRef(new FrameProcessor(exercise));

  const [status, setStatus] = useState<SessionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [delegate, setDelegate] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>({ frame: null, lastEvent: null, fps: 0 });

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stopCamera(videoRef.current, streamRef.current);
    streamRef.current = null;
    const ctx = canvasRef.current?.getContext('2d');
    ctx?.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    setStatus((s) => (s === 'error' ? s : 'idle'));
  }, []);

  const runLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const detector = detectorRef.current;
    const ctx = canvas?.getContext('2d');
    if (!video || !canvas || !detector || !ctx) return;

    let lastVideoTime = -1;
    let lastUiUpdate = 0;
    let lastEvent: CvRepEvent | null = null;
    let frameCount = 0;
    let fpsWindowStart = performance.now();
    let fps = 0;

    const tick = () => {
      const now = performance.now();
      // Only run inference on new video frames.
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        const raw = detector.detect(video, now);
        const result = processorRef.current.process(raw, { width: video.videoWidth, height: video.videoHeight }, now);
        const reliable = result.analysis.setup.status === 'ok';
        drawPose(ctx, result.landmarks, POSE_CONNECTIONS, result.analysis.side, reliable, exercise);

        if (result.event) lastEvent = result.event;
        frameCount++;
        if (now - fpsWindowStart >= 1000) {
          fps = (frameCount * 1000) / (now - fpsWindowStart);
          frameCount = 0;
          fpsWindowStart = now;
        }
        if (now - lastUiUpdate >= UI_UPDATE_INTERVAL_MS) {
          lastUiUpdate = now;
          setSnapshot({ frame: result, lastEvent, fps });
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [exercise]);

  const start = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setStatus('starting');
    try {
      if (!detectorRef.current) {
        detectorRef.current = await createPoseDetector();
        setDelegate(detectorRef.current.delegate);
      }
      streamRef.current = await startCamera(video);
      // Unmounted while starting (e.g. the exercise was skipped): release the camera.
      if (!mountedRef.current) {
        stop();
        detectorRef.current?.close();
        detectorRef.current = null;
        return;
      }
      processorRef.current.reset();
      setSnapshot({ frame: null, lastEvent: null, fps: 0 });
      setStatus('running');
      runLoop();
    } catch (err) {
      stop();
      setStatus('error');
      setError(
        err instanceof CameraError
          ? err.message
          : `Could not load the pose model${err instanceof Error ? `: ${err.message}` : '.'}`,
      );
    }
  }, [runLoop, stop]);

  const resetCount = useCallback(() => {
    processorRef.current.reset();
    setSnapshot((s) => ({ ...s, lastEvent: null }));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
      detectorRef.current?.close();
      detectorRef.current = null;
    };
  }, [stop]);

  /** Structured result of the current set, for workout/session code (the CV boundary). */
  const getSetResult = useCallback(() => processorRef.current.setResult(), []);

  return { videoRef, canvasRef, status, error, delegate, snapshot, start, stop, resetCount, getSetResult };
}
