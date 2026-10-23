import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { Media } from '@/data/types';
import { Icon } from './Icon';
import { Txt } from './Txt';
import { useT } from '@/i18n';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';

/** Callback that runs at most once and never changes identity (safe inside effects). */
function useOnce(fn?: () => void) {
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  const [once] = useState(() => { let done = false; return () => { if (!done) { done = true; latest.current?.(); } }; });
  return once;
}

/** Native lifecycle stays managed by expo-video. Play only once the view has mounted. */
function Video({ uri, poster, fit, onReady }: { uri: string; poster?: string; fit: 'cover' | 'contain'; onReady?: () => void }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const { t } = useT();
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; });
  useEffect(() => {
    const listener = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') player.play();
      setFailed(status === 'error');
      if (status === 'error') onReady?.();
    });
    player.play();
    return () => listener.remove();
  }, [player, onReady]);
  return <>
    {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" onLoad={onReady} onError={onReady} /> : <Skeleton fill r={0} />}
    <VideoView player={player} style={[StyleSheet.absoluteFill, { opacity: ready ? 1 : 0 }]} contentFit={fit} nativeControls={false} playsInline surfaceType="textureView" allowsPictureInPicture={false} onFirstFrameRender={() => { setReady(true); onReady?.(); }} />
    {failed ? <Txt className="absolute bottom-3 start-3 text-white text-[12px]">{t('improve.videoError')}</Txt> : null}
  </>;
}

/** HTML autoplay must be set on the element itself (including iOS playsInline). */
function WebVideo({ uri, poster, fit, onReady }: { uri: string; poster?: string; fit: 'cover' | 'contain'; onReady?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const { t } = useT();
  const play = () => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    void video.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
  };
  // The poster is what a visitor sees first: report the card as painted once it (or the first video frame) is there.
  useEffect(() => {
    if (!onReady || !poster || typeof window === 'undefined') return;
    const img = new window.Image();
    img.onload = img.onerror = () => onReady();
    img.src = poster;
  }, [poster, onReady]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // Pause off-screen cards and resume as they return to view.
    let inView = true;
    const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; if (inView && !document.hidden) play(); else video.pause(); }, { threshold: 0.05 }) : null;
    observer?.observe(video);
    const visibility = () => { if (document.hidden) video.pause(); else if (inView) play(); };
    document.addEventListener('visibilitychange', visibility);
    if (!observer) play();
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', visibility); video.pause(); };
  }, [uri]);
  return <>
    {React.createElement('video', { ref, src: uri, poster, autoPlay: true, muted: true, loop: true, playsInline: true, preload: 'metadata', 'aria-label': t('improve.play'), style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fit }, onError: () => { setFailed(true); onReady?.(); }, onLoadedData: () => onReady?.(), onPlaying: () => setBlocked(false) })}
    {blocked && !failed ? <Pressable accessibilityLabel={t('improve.play')} onPress={(e) => { e.stopPropagation(); play(); }} className="absolute bottom-3 end-3 w-11 h-11 rounded-full bg-ink items-center justify-center"><Icon name="play" tone="onink" /></Pressable> : null}
    {failed ? <Txt className="absolute bottom-3 start-3 text-white text-[12px]">{t('improve.videoError')}</Txt> : null}
  </>;
}

/** Renders an image OR an autoplaying / muted / looping video, with a skeleton while loading. */
export function MediaView({ media, uri, className = '', style, fit = 'cover', children, onAspectRatio, priority, onReady }: {
  media?: Media; uri?: string; className?: string; style?: StyleProp<ViewStyle>; fit?: 'cover' | 'contain'; children?: React.ReactNode; onAspectRatio?: (ratio: number) => void;
  /** Called once the visible picture is on screen (image loaded, video poster / first frame shown) or definitely failed. */
  onReady?: () => void;
  /** 'high' = above the fold (the largest image on first paint): fetched immediately and first, never waits for the scroll observer. */
  priority?: 'high';
}) {
  const [loadedUri, setLoadedUri] = useState('');
  // The admin's loader inside the placeholder of large pictures only (thumbnails keep the plain shimmer).
  const [big, setBig] = useState(false);
  const ready = useOnce(onReady);
  const [nearby, setNearby] = useState(Platform.OS !== 'web' || priority === 'high');
  const container = useRef<View>(null);
  const m: Media | undefined = media ?? (uri ? { type: 'image', uri } : undefined);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = container.current as unknown as Element;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNearby(true); observer.disconnect(); }
    }, { rootMargin: '300px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const active = nearby || Platform.OS !== 'web' || (Platform.OS === 'web' && typeof IntersectionObserver === 'undefined');
  // Nothing to wait for without a picture.
  const hasPicture = !!m?.uri;
  useEffect(() => { if (!hasPicture) ready(); }, [hasPicture, ready]);
  return (
    <View ref={container} className={`overflow-hidden bg-surface2 ${className}`} style={style} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; const next = width >= 120 && height >= 120; if (next !== big) setBig(next); }}>
      {!m?.uri ? null : !active ? <View style={StyleSheet.absoluteFill} /> : m.type === 'video' ? (
        Platform.OS === 'web' ? <WebVideo key={m.uri} uri={m.uri} poster={m.poster} fit={fit} onReady={onReady ? ready : undefined} /> : <Video key={m.uri} uri={m.uri} poster={m.poster} fit={fit} onReady={onReady ? ready : undefined} />
      ) : (
        <>
          {loadedUri !== m.uri ? <><Skeleton fill r={0} />{big ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><Spinner size={36} /></View> : null}</> : null}
          <Image source={{ uri: m.uri }} style={StyleSheet.absoluteFill} contentFit={fit} cachePolicy="memory-disk" priority={priority} loading={priority === 'high' ? 'eager' : undefined} recyclingKey={m.uri} transition={Platform.OS === 'web' ? 0 : 250} onLoad={(e) => { setLoadedUri(m.uri); ready(); if (e.source.width && e.source.height) onAspectRatio?.(e.source.width / e.source.height); }} onError={() => { setLoadedUri(m.uri); ready(); }} />
        </>
      )}
      {children}
    </View>
  );
}
