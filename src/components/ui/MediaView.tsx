import React, { useState } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { Media } from '@/data/types';
import { Skeleton } from './Skeleton';

function Video({ uri, poster, fit }: { uri: string; poster?: string; fit: 'cover' | 'contain' }) {
  const [ready, setReady] = useState(false);
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play(); });
  return (
    <>
      {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Skeleton fill r={0} />}
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, { opacity: ready ? 1 : 0 }]}
        contentFit={fit}
        nativeControls={false}
        allowsPictureInPicture={false}
        onFirstFrameRender={() => setReady(true)}
      />
    </>
  );
}

/** Renders an image OR an autoplaying / muted / looping video, with a skeleton while loading. */
export function MediaView({ media, uri, className = '', style, fit = 'cover', children }: {
  media?: Media; uri?: string; className?: string; style?: StyleProp<ViewStyle>; fit?: 'cover' | 'contain'; children?: React.ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  const m: Media | undefined = media ?? (uri ? { type: 'image', uri } : undefined);
  return (
    <View className={`overflow-hidden bg-surface2 ${className}`} style={style}>
      {!m?.uri ? null : m.type === 'video' ? (
        <Video uri={m.uri} poster={m.poster} fit={fit} />
      ) : (
        <>
          {!loaded ? <Skeleton fill r={0} /> : null}
          <Image source={{ uri: m.uri }} style={StyleSheet.absoluteFill} contentFit={fit} transition={Platform.OS === 'web' ? 0 : 250} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
        </>
      )}
      {children}
    </View>
  );
}
