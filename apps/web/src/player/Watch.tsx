import { formatTimecode, type PlaybackInfo, type QualityId } from '@taazastream/shared';
import { useQuery } from '@tanstack/react-query';
import type Hls from 'hls.js';
import {
  ArrowLeft,
  Captions,
  Check,
  ChevronRight,
  Gauge,
  Info,
  Languages,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Spinner } from '../components/States';
import { api, beacon, qs, type ApiError } from '../lib/api';
import { capabilitiesParam, detectCapabilities } from '../lib/capabilities';
import { channelsLabel, languageName } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';
import { usePrefs } from '../store/prefs';
import { SeekBar } from './SeekBar';

const PROGRESS_EVERY_MS = 10_000;
const HIDE_CONTROLS_MS = 3200;
const NEXT_UP_SECONDS = 20;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
/** Capabilities that force the server to convert (used when direct play fails in this browser). */
const FALLBACK_CAPS = 'h264|aac||mse';

type Menu = null | 'root' | 'quality' | 'audio' | 'subtitles' | 'speed';

function newSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function WatchPage() {
  const { videoId = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [opts, setOpts] = useState<{ quality?: QualityId; audio?: number; fallback?: boolean }>({});
  // Position to restore after a source switch (quality/audio change, fallback).
  const restoreAt = useRef<number | null>(search.get('start') === '0' ? 0 : null);

  useEffect(() => {
    setOpts({});
    restoreAt.current = search.get('start') === '0' ? 0 : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const {
    data: info,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['playback', videoId, opts],
    queryFn: () =>
      api.get<PlaybackInfo>(
        `/api/playback/${videoId}${qs({ caps: opts.fallback ? FALLBACK_CAPS : capabilitiesParam(), quality: opts.quality, audio: opts.audio })}`,
      ),
    staleTime: Infinity,
    gcTime: 0,
    retry: 1,
  });
  useDocumentTitle(
    info ? (info.subtitle ? `${info.title} · ${info.subtitle}` : info.title) : 'Playing',
  );

  const exit = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else
      navigate(
        info
          ? info.kind === 'series'
            ? `/series/${info.titleId}`
            : `/movie/${info.titleId}`
          : '/',
      );
  }, [navigate, info]);

  if (error) {
    const e = error as ApiError;
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <h1 className="font-display text-2xl font-semibold">
          {e.code === 'MEDIA_MISSING' ? 'Video file not found' : 'Can’t play this video'}
        </h1>
        <p className="max-w-md text-muted">{e.message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-full bg-white px-6 py-2.5 font-semibold text-black"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={exit}
            className="rounded-full border border-white/30 px-6 py-2.5"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <Spinner className="h-14 w-14" />
      </div>
    );
  }

  return (
    <Player
      key={`${info.videoId}:${info.url}`}
      info={info}
      switching={isFetching}
      startAt={restoreAt.current ?? info.resumeSec}
      resumed={restoreAt.current == null && info.resumeSec > 0}
      onExit={exit}
      onChangeSource={(next, at) => {
        restoreAt.current = at;
        setOpts((o) => ({ ...o, ...next }));
      }}
      onNext={(nextVideoId) => navigate(`/watch/${nextVideoId}`, { replace: true })}
    />
  );
}

interface PlayerProps {
  info: PlaybackInfo;
  startAt: number;
  resumed: boolean;
  switching: boolean;
  onExit: () => void;
  onChangeSource: (
    next: { quality?: QualityId; audio?: number; fallback?: boolean },
    at: number,
  ) => void;
  onNext: (videoId: string) => void;
}

function Player({
  info,
  startAt,
  resumed,
  switching,
  onExit,
  onChangeSource,
  onNext,
}: PlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const session = useRef(newSessionId());
  const lastReport = useRef(0);
  const hideTimer = useRef<number | null>(null);
  const prefs = usePrefs();

  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [current, setCurrent] = useState(startAt);
  const [duration, setDuration] = useState(info.durationSec);
  const [buffered, setBuffered] = useState(0);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState<Menu>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [levels, setLevels] = useState<{ height: number; bitrate: number }[]>([]);
  const [level, setLevel] = useState(-1);
  const [autoLevel, setAutoLevel] = useState(-1);
  const [subtitleId, setSubtitleId] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [toast, setToast] = useState<string | null>(
    resumed ? `Resumed at ${formatTimecode(startAt)}` : null,
  );
  const [ripple, setRipple] = useState<{ side: 'left' | 'right'; key: number } | null>(null);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  /* ---------------------------- progress reporting ---------------------------- */
  const report = useCallback(
    (opts: { flush?: boolean; completed?: boolean; unload?: boolean } = {}) => {
      const v = video.current;
      if (!v || !Number.isFinite(v.currentTime)) return;
      const body = {
        videoId: info.videoId,
        positionSec: Math.max(0, v.currentTime),
        durationSec: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : info.durationSec,
        completed: opts.completed,
        sessionId: session.current,
      };
      lastReport.current = Date.now();
      const url = `/api/watch-progress${opts.flush || opts.unload ? '?flush=1' : ''}`;
      if (opts.unload) beacon(url, body);
      else void api.post(url, body).catch(() => undefined);
    },
    [info.videoId, info.durationSec],
  );

  /* ---------------------------- source attachment ---------------------------- */
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let cancelled = false;
    let networkRetries = 0;
    const caps = detectCapabilities();

    const seekToStart = () => {
      if (startAt > 0 && Math.abs(v.currentTime - startAt) > 1) {
        try {
          v.currentTime = startAt;
        } catch {
          /* not seekable yet */
        }
      }
    };
    const tryPlay = () => {
      v.play()
        .then(() => setNeedsGesture(false))
        .catch(() => setNeedsGesture(true)); // autoplay blocked: show a big play button
    };

    // Safari/iOS (and browsers without MSE) play HLS natively; everyone else uses hls.js.
    if (info.isHls && caps.hls !== 'native') {
      void import('hls.js').then(({ default: HlsCtor }) => {
        if (cancelled) return;
        if (!HlsCtor.isSupported()) {
          v.src = info.url;
          v.addEventListener('loadedmetadata', seekToStart, { once: true });
          tryPlay();
          return;
        }
        const hls = new HlsCtor({
          startPosition: startAt > 0 ? startAt : -1,
          maxBufferLength: 30,
          maxMaxBufferLength: 90,
          backBufferLength: 30,
          enableWorker: true,
          capLevelToPlayerSize: false,
          startLevel: 0,
          manifestLoadingMaxRetry: 4,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 8,
          fragLoadingRetryDelay: 500,
          // Transcoded segments can take a few seconds to produce on slower CPUs.
          fragLoadingTimeOut: 60_000,
          levelLoadingTimeOut: 60_000,
          manifestLoadingTimeOut: 30_000,
        });
        hlsRef.current = hls;
        hls.on(HlsCtor.Events.MANIFEST_PARSED, (_e, data) => {
          setLevels(data.levels.map((l) => ({ height: l.height, bitrate: l.bitrate })));
          tryPlay();
        });
        hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_e, data) => setAutoLevel(data.level));
        hls.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && networkRetries < 6) {
            networkRetries++;
            setWaiting(true);
            window.setTimeout(() => hls.startLoad(), Math.min(8000, 1000 * 2 ** networkRetries));
          } else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setFatal('Playback failed. The stream could not be loaded from the server.');
          }
        });
        hls.loadSource(info.url);
        hls.attachMedia(v);
      });
    } else {
      v.src = info.url;
      v.addEventListener('loadedmetadata', seekToStart, { once: true });
      tryPlay();
    }

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      v.removeAttribute('src');
      v.load();
    };
  }, [info.url, info.isHls, startAt]);

  /* ---------------------------- media element events ---------------------------- */
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.volume = prefs.volume;
    v.muted = prefs.muted;
    v.playbackRate = prefs.playbackRate;

    const onTime = () => {
      setCurrent(v.currentTime);
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime)
          setBuffered(v.buffered.end(i));
      }
      if (!v.paused && Date.now() - lastReport.current > PROGRESS_EVERY_MS) report();
    };
    const onPlay = () => {
      setPlaying(true);
      setNeedsGesture(false);
    };
    const onPause = () => {
      setPlaying(false);
      report({ flush: true });
    };
    const onEnded = () => {
      setPlaying(false);
      report({ flush: true, completed: true });
    };
    const onError = () => {
      const err = v.error;
      if (!err) return;
      // Direct play failed in this browser (codec/container it claimed to support): ask the server to convert.
      if (
        info.mode === 'direct' &&
        (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
          err.code === MediaError.MEDIA_ERR_DECODE)
      ) {
        onChangeSource({ fallback: true }, v.currentTime || startAt);
        return;
      }
      if (err.code === MediaError.MEDIA_ERR_NETWORK)
        setFatal('Lost connection to the server. Check your Wi-Fi and try again.');
      else if (info.mode !== 'direct' || err.code !== MediaError.MEDIA_ERR_ABORTED)
        setFatal('This video could not be played.');
    };
    const onDuration = () =>
      Number.isFinite(v.duration) && v.duration > 0 && setDuration(v.duration);
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => setWaiting(false);
    const onVolume = () => prefs.set({ volume: v.volume, muted: v.muted });

    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', onError);
    v.addEventListener('durationchange', onDuration);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('seeking', onWaiting);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('canplay', onPlaying);
    v.addEventListener('seeked', onPlaying);
    v.addEventListener('volumechange', onVolume);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('error', onError);
      v.removeEventListener('durationchange', onDuration);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('seeking', onWaiting);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('canplay', onPlaying);
      v.removeEventListener('seeked', onPlaying);
      v.removeEventListener('volumechange', onVolume);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.videoId, info.mode, report]);

  // Save position when leaving the page, hiding the tab or closing the app.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') report({ unload: true });
    };
    const onPageHide = () => report({ unload: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      report({ unload: true });
    };
  }, [report]);

  /* ---------------------------- subtitles ---------------------------- */
  useEffect(() => {
    const preferred = prefs.subtitleLang
      ? info.subtitles.find((s) => s.url && s.language === prefs.subtitleLang)
      : info.subtitles.find((s) => s.url && s.forced);
    setSubtitleId(preferred?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.videoId]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const apply = () => {
      for (const track of Array.from(v.textTracks)) {
        track.mode = track.id === subtitleId || track.label === subtitleId ? 'showing' : 'disabled';
      }
    };
    apply();
    v.textTracks.addEventListener?.('addtrack', apply);
    return () => v.textTracks.removeEventListener?.('addtrack', apply);
  }, [subtitleId, info.url]);

  /* ---------------------------- controls visibility ---------------------------- */
  const poke = useCallback(() => {
    setControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!video.current?.paused) {
        setControls(false);
        setMenu(null);
      }
    }, HIDE_CONTROLS_MS);
  }, []);

  useEffect(() => {
    if (!playing) setControls(true);
    else poke();
  }, [playing, poke]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  /* ---------------------------- actions ---------------------------- */
  const togglePlay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setNeedsGesture(true));
    else v.pause();
  }, []);

  const seekTo = useCallback(
    (t: number) => {
      const v = video.current;
      if (!v) return;
      const max = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : info.durationSec;
      v.currentTime = Math.min(Math.max(0, t), Math.max(0, max - 0.25));
      setCurrent(v.currentTime);
    },
    [info.durationSec],
  );

  const skip = useCallback(
    (delta: number) => {
      const v = video.current;
      if (v) seekTo(v.currentTime + delta);
      setRipple({ side: delta < 0 ? 'left' : 'right', key: Date.now() });
    },
    [seekTo],
  );

  const toggleFullscreen = useCallback(async () => {
    const el = shell.current;
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (el?.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
          .lock?.('landscape')
          .catch(() => undefined);
      } else v?.webkitEnterFullscreen?.(); // iPhone
    } catch {
      /* not allowed */
    }
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const togglePip = useCallback(async () => {
    const v = video.current as
      (HTMLVideoElement & { webkitSetPresentationMode?: (m: string) => void }) | null;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await v.requestPictureInPicture();
      else v.webkitSetPresentationMode?.('picture-in-picture');
    } catch {
      /* unsupported */
    }
  }, []);

  const setVolume = (vol: number) => {
    const v = video.current;
    if (!v) return;
    v.volume = Math.min(1, Math.max(0, vol));
    v.muted = v.volume === 0;
  };

  const goNext = useCallback(() => {
    if (!info.next) return;
    report({ flush: true, completed: true });
    onNext(info.next.videoId);
  }, [info.next, onNext, report]);

  /* ---------------------------- next episode ---------------------------- */
  const remaining = duration - current;
  const nearEnd = !!info.next && duration > 0 && remaining <= NEXT_UP_SECONDS && !nextDismissed;
  useEffect(() => {
    if (!nearEnd || !prefs.autoplayNext) {
      setNextCountdown(null);
      return;
    }
    setNextCountdown((c) => c ?? Math.max(5, Math.min(10, Math.ceil(remaining))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearEnd, prefs.autoplayNext]);
  useEffect(() => {
    if (nextCountdown == null || !playing) return;
    if (nextCountdown <= 0) {
      goNext();
      return;
    }
    const t = window.setTimeout(() => setNextCountdown((c) => (c == null ? c : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [nextCountdown, playing, goNext]);
  useEffect(() => {
    const v = video.current;
    const onEnded = () => info.next && prefs.autoplayNext && !nextDismissed && goNext();
    v?.addEventListener('ended', onEnded);
    return () => v?.removeEventListener('ended', onEnded);
  }, [info.next, prefs.autoplayNext, nextDismissed, goNext]);

  /* ---------------------------- keyboard / remote ---------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest('[role="menu"]') && ['ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key))
        return;
      const v = video.current;
      if (!v) return;
      let handled = true;
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
        case 'MediaPlayPause':
          if (target.tagName === 'BUTTON' && e.key === ' ') {
            handled = false;
            break;
          }
          togglePlay();
          break;
        case 'MediaPlay':
          void v.play();
          break;
        case 'MediaPause':
          v.pause();
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J':
        case 'MediaRewind':
          skip(-10);
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
        case 'MediaFastForward':
          skip(10);
          break;
        case 'ArrowUp':
          setVolume(v.volume + 0.1);
          break;
        case 'ArrowDown':
          setVolume(v.volume - 0.1);
          break;
        case 'm':
        case 'M':
          v.muted = !v.muted;
          break;
        case 'f':
        case 'F':
          void toggleFullscreen();
          break;
        case 'c':
        case 'C': {
          const first = info.subtitles.find((s) => s.url);
          setSubtitleId((id) => (id ? null : (first?.id ?? null)));
          break;
        }
        case 'n':
        case 'N':
          goNext();
          break;
        case 'p':
        case 'P':
          void togglePip();
          break;
        case 'i':
        case 'I':
          setShowStats((s) => !s);
          break;
        case 'Home':
          seekTo(0);
          break;
        case 'End':
          seekTo(duration - 1);
          break;
        case 'Escape':
        case 'Backspace':
        case 'BrowserBack':
          if (menu) setMenu(null);
          else if (!document.fullscreenElement) onExit();
          else handled = false;
          break;
        default:
          if (/^[0-9]$/.test(e.key)) seekTo((Number(e.key) / 10) * duration);
          else handled = false;
      }
      if (handled) {
        e.preventDefault();
        poke();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    togglePlay,
    skip,
    toggleFullscreen,
    togglePip,
    goNext,
    seekTo,
    duration,
    menu,
    onExit,
    poke,
    info.subtitles,
  ]);

  /* ---------------------------- quality / audio ---------------------------- */
  const qualityItems = useMemo(() => {
    if (info.isHls && levels.length > 1) {
      return [
        {
          key: 'auto',
          label: `Auto${level === -1 && autoLevel >= 0 && levels[autoLevel] ? ` (${levels[autoLevel]!.height}p)` : ''}`,
          active: level === -1,
          pick: () => {
            if (hlsRef.current) hlsRef.current.currentLevel = -1;
            setLevel(-1);
          },
        },
        ...levels
          .map((l, i) => ({ l, i }))
          .sort((a, b) => b.l.height - a.l.height)
          .map(({ l, i }) => ({
            key: `lvl-${i}`,
            label: `${l.height}p`,
            active: level === i,
            pick: () => {
              if (hlsRef.current) hlsRef.current.currentLevel = i;
              setLevel(i);
            },
          })),
        ...(info.mode === 'transcode'
          ? [
              {
                key: 'original',
                label: 'Original (direct, if supported)',
                active: false,
                pick: () =>
                  onChangeSource({ quality: 'original' }, video.current?.currentTime ?? 0),
              },
            ]
          : []),
      ];
    }
    return info.qualities.map((q) => ({
      key: q.id,
      label: q.id === 'original' ? `Original${q.height ? ` (${q.height}p)` : ''}` : q.label,
      active: info.quality === q.id || (q.id === 'original' && info.mode !== 'transcode'),
      pick: () => onChangeSource({ quality: q.id }, video.current?.currentTime ?? 0),
    }));
  }, [info, levels, level, autoLevel, onChangeSource]);

  const activeSubtitle = info.subtitles.find((s) => s.id === subtitleId);
  const activeAudio = info.audioTracks.find((a) => a.index === info.audioIndex);
  const audioLabel = (a: (typeof info.audioTracks)[number]) =>
    [
      a.title ?? languageName(a.language) ?? `Track ${a.index + 1}`,
      channelsLabel(a.channels),
      a.codec.toUpperCase(),
    ]
      .filter(Boolean)
      .join(' · ');

  /* ---------------------------- tap handling (mobile) ---------------------------- */
  const lastTap = useRef<{ t: number; x: number } | null>(null);
  const onSurfacePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') {
      togglePlay();
      return;
    }
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (lastTap.current && now - lastTap.current.t < 300) {
      if (x < 0.4) skip(-10);
      else if (x > 0.6) skip(10);
      else void toggleFullscreen();
      lastTap.current = null;
      return;
    }
    lastTap.current = { t: now, x };
    window.setTimeout(() => {
      if (lastTap.current && lastTap.current.t === now) {
        setControls((c) => !c);
        if (!controls) poke();
        lastTap.current = null;
      }
    }, 280);
  };

  const VolumeIcon =
    prefs.muted || prefs.volume === 0 ? VolumeX : prefs.volume < 0.5 ? Volume1 : Volume2;
  const showUi = controls || !playing || !!menu;

  return (
    <div
      ref={shell}
      className={`fixed inset-0 z-50 bg-black select-none ${showUi ? '' : 'cursor-none'}`}
      onPointerMove={(e) => e.pointerType === 'mouse' && poke()}
      data-no-spatial
    >
      <video
        ref={video}
        className="absolute inset-0 h-full w-full bg-black object-contain"
        playsInline
        preload="auto"
        poster={info.backdropUrl ?? undefined}
        aria-label={info.title}
      >
        {info.subtitles
          .filter((s) => s.url)
          .map((s) => (
            <track
              key={s.id}
              id={s.id}
              kind="subtitles"
              src={s.url!}
              srcLang={s.language ?? undefined}
              label={s.label}
            />
          ))}
      </video>

      {/* Gesture surface */}
      <div className="absolute inset-0" onPointerUp={onSurfacePointer} aria-hidden="true" />

      {/* Double-tap ripple */}
      {ripple && (
        <div
          key={ripple.key}
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 animate-fade-in ${ripple.side === 'left' ? 'left-[12%]' : 'right-[12%]'}`}
        >
          <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-white/15 text-xs font-semibold backdrop-blur">
            {ripple.side === 'left' ? (
              <RotateCcw className="mb-1 h-6 w-6" />
            ) : (
              <RotateCw className="mb-1 h-6 w-6" />
            )}
            10s
          </div>
        </div>
      )}

      {(waiting || switching) && !fatal && !needsGesture && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner className="h-14 w-14" />
        </div>
      )}

      {needsGesture && !fatal && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play"
          className="absolute top-1/2 left-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-2xl transition hover:scale-105"
        >
          <Play className="ml-1 h-10 w-10 fill-current" />
        </button>
      )}

      {fatal && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center">
          <p className="max-w-md text-lg">{fatal}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setFatal(null);
                onChangeSource({}, video.current?.currentTime ?? current);
              }}
              className="rounded-full bg-white px-6 py-2.5 font-semibold text-black"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={onExit}
              className="rounded-full border border-white/30 px-6 py-2.5"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="glass absolute top-20 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full py-2 pr-2 pl-4 text-sm animate-fade-in">
          {toast}
          {resumed && (
            <button
              type="button"
              onClick={() => {
                seekTo(0);
                setToast(null);
              }}
              className="rounded-full bg-white/15 px-3 py-1 font-medium hover:bg-white/25"
            >
              Start over
            </button>
          )}
        </div>
      )}

      {showStats && (
        <div className="glass absolute top-20 left-4 max-w-sm rounded-xl p-4 font-mono text-xs leading-relaxed text-white/85">
          <p>mode: {info.mode}</p>
          <p className="text-white/60">{info.reason}</p>
          <p>quality: {info.isHls ? (levels[autoLevel]?.height ?? '?') + 'p' : 'original'}</p>
          <p>
            video: {video.current?.videoWidth}×{video.current?.videoHeight}
          </p>
          <p>buffer: {(buffered - current).toFixed(1)}s</p>
          <p>audio: {activeAudio ? audioLabel(activeAudio) : '—'}</p>
        </div>
      )}

      {/* Next episode card */}
      {nearEnd && info.next && (
        <div className="glass absolute right-4 bottom-28 z-10 w-72 overflow-hidden rounded-2xl shadow-2xl animate-rise-in md:right-10 md:w-80">
          {info.next.thumbUrl && (
            <img src={info.next.thumbUrl} alt="" className="aspect-video w-full object-cover" />
          )}
          <div className="p-4">
            <p className="text-xs tracking-wider text-brand-300 uppercase">Next episode</p>
            <p className="mt-1 font-medium">
              S{info.next.seasonNumber}:E{info.next.episodeNumber} · {info.next.title}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={goNext}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white py-2 text-sm font-semibold text-black"
              >
                <Play className="h-4 w-4 fill-current" />{' '}
                {nextCountdown != null ? `Play in ${nextCountdown}s` : 'Play now'}
              </button>
              <button
                type="button"
                onClick={() => setNextDismissed(true)}
                className="rounded-lg border border-white/25 px-3 text-sm"
              >
                Hide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${showUi ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/80 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/90 to-transparent" />

        <div className="pointer-events-auto absolute inset-x-0 top-0 flex items-center gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] md:px-8 md:pt-6">
          <button
            type="button"
            onClick={onExit}
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold md:text-xl">{info.title}</p>
            {info.subtitle && <p className="truncate text-sm text-white/70">{info.subtitle}</p>}
          </div>
        </div>

        {/* Centre transport (touch/TV friendly) */}
        <div className="pointer-events-auto absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-8 md:gap-14">
          <button
            type="button"
            onClick={() => skip(-10)}
            aria-label="Back 10 seconds"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-black/30 backdrop-blur hover:bg-white/15"
          >
            <RotateCcw className="h-7 w-7" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25"
          >
            {playing ? (
              <Pause className="h-9 w-9 fill-current" />
            ) : (
              <Play className="ml-1 h-9 w-9 fill-current" />
            )}
          </button>
          <button
            type="button"
            onClick={() => skip(10)}
            aria-label="Forward 10 seconds"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-black/30 backdrop-blur hover:bg-white/15"
          >
            <RotateCw className="h-7 w-7" />
          </button>
        </div>

        <div className="pointer-events-auto absolute inset-x-0 bottom-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-8 md:pb-6">
          <div className="flex items-center gap-3 md:gap-4">
            <span className="w-14 text-right font-mono text-xs text-white/85 tabular-nums md:text-sm">
              {formatTimecode(current)}
            </span>
            <div className="flex-1">
              <SeekBar
                current={current}
                duration={duration}
                buffered={buffered}
                onSeek={(t) => seekTo(t)}
                onScrub={(s) => {
                  setScrubbing(s);
                  poke();
                }}
              />
            </div>
            <span className="w-14 font-mono text-xs text-white/60 tabular-nums md:text-sm">
              -{formatTimecode(Math.max(0, duration - current))}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1 md:gap-2">
            <CtlButton label={playing ? 'Pause (K)' : 'Play (K)'} onClick={togglePlay}>
              {playing ? (
                <Pause className="h-6 w-6 fill-current" />
              ) : (
                <Play className="h-6 w-6 fill-current" />
              )}
            </CtlButton>
            <CtlButton
              label="Back 10 seconds (J)"
              onClick={() => skip(-10)}
              className="hidden sm:flex"
            >
              <RotateCcw className="h-5 w-5" />
            </CtlButton>
            <CtlButton
              label="Forward 10 seconds (L)"
              onClick={() => skip(10)}
              className="hidden sm:flex"
            >
              <RotateCw className="h-5 w-5" />
            </CtlButton>
            <div className="group/vol flex items-center">
              <CtlButton
                label={prefs.muted ? 'Unmute (M)' : 'Mute (M)'}
                onClick={() => video.current && (video.current.muted = !video.current.muted)}
              >
                <VolumeIcon className="h-6 w-6" />
              </CtlButton>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={prefs.muted ? 0 : prefs.volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="ts-range hidden w-0 transition-[width] duration-300 group-hover/vol:w-24 focus-visible:w-24 md:block"
                style={{ ['--fill' as string]: `${(prefs.muted ? 0 : prefs.volume) * 100}%` }}
              />
            </div>
            {info.next && (
              <CtlButton label="Next episode (N)" onClick={goNext}>
                <SkipForward className="h-6 w-6 fill-current" />
              </CtlButton>
            )}
            <div className="ml-auto flex items-center gap-1 md:gap-2">
              {info.subtitles.some((s) => s.url) && (
                <CtlButton
                  label="Subtitles (C)"
                  onClick={() => setMenu(menu === 'subtitles' ? null : 'subtitles')}
                  active={!!activeSubtitle}
                >
                  <Captions className="h-6 w-6" />
                </CtlButton>
              )}
              <CtlButton
                label="Settings"
                onClick={() => setMenu(menu ? null : 'root')}
                active={!!menu && menu !== 'subtitles'}
              >
                <Settings className="h-6 w-6" />
              </CtlButton>
              {typeof document !== 'undefined' && document.pictureInPictureEnabled && (
                <CtlButton
                  label="Picture in picture (P)"
                  onClick={() => void togglePip()}
                  className="hidden sm:flex"
                >
                  <PictureInPicture2 className="h-6 w-6" />
                </CtlButton>
              )}
              <CtlButton
                label={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}
                onClick={() => void toggleFullscreen()}
              >
                {fullscreen ? <Minimize className="h-6 w-6" /> : <Maximize className="h-6 w-6" />}
              </CtlButton>
            </div>
          </div>
        </div>

        {menu && (
          <div
            role="menu"
            className="glass pointer-events-auto absolute right-4 bottom-28 max-h-[60vh] w-72 overflow-y-auto rounded-2xl py-2 shadow-2xl md:right-8"
            data-nav-scope
          >
            {menu === 'root' && (
              <>
                <MenuRow
                  icon={<Gauge className="h-5 w-5" />}
                  label="Quality"
                  value={qualityItems.find((q) => q.active)?.label ?? 'Auto'}
                  onClick={() => setMenu('quality')}
                />
                {info.audioTracks.length > 1 && (
                  <MenuRow
                    icon={<Languages className="h-5 w-5" />}
                    label="Audio"
                    value={
                      activeAudio
                        ? (activeAudio.title ??
                          languageName(activeAudio.language) ??
                          `Track ${activeAudio.index + 1}`)
                        : '—'
                    }
                    onClick={() => setMenu('audio')}
                  />
                )}
                {info.subtitles.some((s) => s.url) && (
                  <MenuRow
                    icon={<Captions className="h-5 w-5" />}
                    label="Subtitles"
                    value={activeSubtitle?.label ?? 'Off'}
                    onClick={() => setMenu('subtitles')}
                  />
                )}
                <MenuRow
                  icon={<RotateCw className="h-5 w-5" />}
                  label="Speed"
                  value={`${prefs.playbackRate}×`}
                  onClick={() => setMenu('speed')}
                />
                {info.next && (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={prefs.autoplayNext}
                    onClick={() => prefs.set({ autoplayNext: !prefs.autoplayNext })}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10"
                  >
                    Autoplay next episode
                    <span
                      className={`h-5 w-9 rounded-full p-0.5 transition ${prefs.autoplayNext ? 'bg-brand-500' : 'bg-white/25'}`}
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white transition ${prefs.autoplayNext ? 'translate-x-4' : ''}`}
                      />
                    </span>
                  </button>
                )}
                <MenuRow
                  icon={<Info className="h-5 w-5" />}
                  label="Playback info"
                  value={showStats ? 'On' : 'Off'}
                  onClick={() => setShowStats((s) => !s)}
                />
              </>
            )}
            {menu === 'quality' && (
              <MenuList
                title="Quality"
                onBack={() => setMenu('root')}
                items={qualityItems.map((q) => ({
                  key: q.key,
                  label: q.label,
                  active: q.active,
                  onClick: () => {
                    q.pick();
                    setMenu(null);
                  },
                }))}
              />
            )}
            {menu === 'audio' && (
              <MenuList
                title="Audio"
                onBack={() => setMenu('root')}
                items={info.audioTracks.map((a) => ({
                  key: String(a.index),
                  label: audioLabel(a),
                  active: a.index === info.audioIndex,
                  onClick: () => {
                    setMenu(null);
                    if (a.index !== info.audioIndex)
                      onChangeSource({ audio: a.index }, video.current?.currentTime ?? 0);
                  },
                }))}
              />
            )}
            {menu === 'subtitles' && (
              <MenuList
                title="Subtitles"
                onBack={() => setMenu('root')}
                items={[
                  {
                    key: 'off',
                    label: 'Off',
                    active: !subtitleId,
                    onClick: () => {
                      setSubtitleId(null);
                      prefs.set({ subtitleLang: null });
                      setMenu(null);
                    },
                  },
                  ...info.subtitles
                    .filter((s) => s.url)
                    .map((s) => ({
                      key: s.id,
                      label: s.label,
                      active: s.id === subtitleId,
                      onClick: () => {
                        setSubtitleId(s.id);
                        prefs.set({ subtitleLang: s.language });
                        setMenu(null);
                      },
                    })),
                ]}
              />
            )}
            {menu === 'speed' && (
              <MenuList
                title="Playback speed"
                onBack={() => setMenu('root')}
                items={SPEEDS.map((s) => ({
                  key: String(s),
                  label: s === 1 ? 'Normal' : `${s}×`,
                  active: prefs.playbackRate === s,
                  onClick: () => {
                    if (video.current) video.current.playbackRate = s;
                    prefs.set({ playbackRate: s });
                    setMenu(null);
                  },
                }))}
              />
            )}
          </div>
        )}
      </div>
      {scrubbing && (
        <div className="sr-only" aria-live="polite">
          {formatTimecode(current)}
        </div>
      )}
    </div>
  );
}

function CtlButton({
  label,
  onClick,
  children,
  className = '',
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-white/15 ${active ? 'text-brand-400' : 'text-white'} ${className}`}
    >
      {children}
    </button>
  );
}

function MenuRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/10 focus-visible:bg-white/10"
    >
      <span className="text-white/70">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="max-w-28 truncate text-white/60">{value}</span>
      <ChevronRight className="h-4 w-4 text-white/50" />
    </button>
  );
}

function MenuList({
  title,
  items,
  onBack,
}: {
  title: string;
  onBack: () => void;
  items: { key: string; label: string; active: boolean; onClick: () => void }[];
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center gap-2 border-b border-white/10 px-4 pt-1 pb-2.5 text-sm font-semibold hover:text-white/80"
      >
        <ArrowLeft className="h-4 w-4" /> {title}
      </button>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="menuitemradio"
          aria-checked={it.active}
          onClick={it.onClick}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/10 focus-visible:bg-white/10"
        >
          <span className="w-4">{it.active && <Check className="h-4 w-4 text-brand-400" />}</span>
          <span className="flex-1 truncate">{it.label}</span>
        </button>
      ))}
    </div>
  );
}
