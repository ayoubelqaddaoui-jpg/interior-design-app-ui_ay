import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { Media } from '@/data/types';
import { Icon } from './Icon';
import { Txt } from './Txt';
import { useT } from '@/i18n';
import { Skeleton } from './Skeleton';

/** Native lifecycle stays managed by expo-video. Play only once the view has mounted. */
function Video({ uri, poster, fit }: { uri: string; poster?: string; fit: 'cover' | 'contain' }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const { t } = useT();
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; });
  useEffect(() => {
    const listener = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') player.play();
      setFailed(status === 'error');
    });
    player.play();
    return () => listener.remove();
  }, [player]);
  return <>
    {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Skeleton fill r={0} />}
    <VideoView player={player} style={[StyleSheet.absoluteFill, { opacity: ready ? 1 : 0 }]} contentFit={fit} nativeControls={false} playsInline surfaceType="textureView" allowsPictureInPicture={false} onFirstFrameRender={() => setReady(true)} />
    {failed ? <Txt className="absolute bottom-3 start-3 text-white text-[12px]">{t('improve.videoError')}</Txt> : null}
  </>;
}

/** HTML autoplay must be set on the element itself (including iOS playsInline). */
function WebVideo({ uri, poster, fit }: { uri: string; poster?: string; fit: 'cover' | 'contain' }) {
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
    {React.createElement('video', { ref, src: uri, poster, autoPlay: true, muted: true, loop: true, playsInline: true, preload: 'metadata', 'aria-label': t('improve.play'), style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fit }, onError: () => setFailed(true), onPlaying: () => setBlocked(false) })}
    {blocked && !failed ? <Pressable accessibilityLabel={t('improve.play')} onPress={(e) => { e.stopPropagation(); play(); }} className="absolute bottom-3 end-3 w-11 h-11 rounded-full bg-ink items-center justify-center"><Icon name="play" tone="onink" /></Pressable> : null}
    {failed ? <Txt className="absolute bottom-3 start-3 text-white text-[12px]">{t('improve.videoError')}</Txt> : null}
  </>;
}

/** Renders an image OR an autoplaying / muted / looping video, with a skeleton while loading. */
export function MediaView({ media, uri, className = '', style, fit = 'cover', children, onAspectRatio }: {
  media?: Media; uri?: string; className?: string; style?: StyleProp<ViewStyle>; fit?: 'cover' | 'contain'; children?: React.ReactNode; onAspectRatio?: (ratio: number) => void;
}) {
  const [loadedUri, setLoadedUri] = useState('');
  const [nearby, setNearby] = useState(Platform.OS !== 'web');
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
  return (
    <View ref={container} className={`overflow-hidden bg-surface2 ${className}`} style={style}>
      {!m?.uri ? null : !active ? <View style={StyleSheet.absoluteFill} /> : m.type === 'video' ? (
        Platform.OS === 'web' ? <WebVideo key={m.uri} uri={m.uri} poster={m.poster} fit={fit} /> : <Video key={m.uri} uri={m.uri} poster={m.poster} fit={fit} />
      ) : (
        <>
          {loadedUri !== m.uri ? <Skeleton fill r={0} /> : null}
          <Image source={{ uri: m.uri }} style={StyleSheet.absoluteFill} contentFit={fit} cachePolicy="memory-disk" recyclingKey={m.uri} transition={Platform.OS === 'web' ? 0 : 250} onLoad={(e) => { setLoadedUri(m.uri); if (e.source.width && e.source.height) onAspectRatio?.(e.source.width / e.source.height); }} onError={() => setLoadedUri(m.uri)} />
        </>
      )}
      {children}
    </View>
  );
}
