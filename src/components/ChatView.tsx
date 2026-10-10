import React, { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useStore } from '@/store/useStore';
import { services, ME } from '@/data/repositories';
import { useL, useT } from '@/i18n';
import { Icon, Sheet, Txt } from '@/components/ui';
import { pickPhoto } from '@/lib/photo';
import { uid } from '@/lib/uid';
import { useTheme } from '@/theme/ThemeProvider';
import { toast } from '@/store/useToast';
import type { ChatMessage, Conversation } from '@/data/types';

function Dot({ d }: { d: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => { v.value = withDelay(d, withRepeat(withSequence(withTiming(1, { duration: 350 }), withTiming(0.3, { duration: 350 })), -1)); }, [d, v]);
  const s = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={s} className="w-2 h-2 rounded-full bg-muted" />;
}

/** AI chat: persisted conversations, image attach, demo replies (Darija / Arabic / French aware). */
export function ChatView({ conversationId, onCreated, header }: { conversationId?: string; onCreated?: (id: string) => void; header?: React.ReactNode }) {
  const { t } = useT();
  const L = useL();
  const { colors } = useTheme();
  const config = useStore((s) => s.doc.assistant);
  const conv = useStore((s) => s.conversations.find((c) => c.id === conversationId));
  const [text, setText] = useState('');
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [attach, setAttach] = useState(false);
  const list = useRef<FlatList>(null);
  const [local, setLocal] = useState<ChatMessage[]>([]);
  const messages = conv?.messages ?? local;

  useEffect(() => { setTimeout(() => list.current?.scrollToEnd({ animated: true }), 80); }, [messages.length, busy]);

  const pick = async (src: 'camera' | 'gallery') => {
    setAttach(false);
    const r = await pickPhoto(src);
    if ('uri' in r) setImage(r.uri); else if (r.error === 'permission') toast(t('wizard.permission'));
  };

  const send = async () => {
    const msg = text.trim();
    if ((!msg && !image) || busy) return;
    const um: ChatMessage = { id: uid('m'), role: 'user', text: msg, image: image || undefined, createdAt: Date.now() };
    setText(''); setImage(''); setBusy(true);
    const st = useStore.getState();
    let c: Conversation | undefined = conv;
    const base = c?.messages ?? [];
    const next = [...base, um];
    if (!c) {
      c = await st.create('conversations', { userId: ME, title: msg.slice(0, 40) || t('history.newChat'), messages: next, updatedAt: Date.now() });
      onCreated?.(c.id);
    } else await st.update('conversations', c.id, { messages: next, updatedAt: Date.now() });
    setLocal(next);
    const reply = await services.chat.reply({ messages: next, config });
    const am: ChatMessage = { id: uid('m'), role: 'assistant', text: reply, createdAt: Date.now() };
    await useStore.getState().update('conversations', c.id, { messages: [...next, am], updatedAt: Date.now() });
    setBusy(false);
  };

  const data = messages;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      {header}
      <FlatList
        ref={list}
        data={data}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        ListEmptyComponent={
          <Animated.View entering={FadeInDown.duration(400)} className="flex-1 items-center justify-center py-12">
            <Icon name="star-four-points" size={34} tone="primary" color="#FBDD2D" />
            <Txt className="text-[22px] font-extrabold text-center mt-3">{t('assistant.hello')}</Txt>
            {L(config.welcome) ? <Txt className="text-muted text-center mt-2 px-6">{L(config.welcome)}</Txt> : null}
          </Animated.View>
        }
        renderItem={({ item: m }) => (
          <Animated.View entering={FadeInDown.duration(250)} className={`mb-2.5 max-w-[82%] ${m.role === 'user' ? 'self-end' : 'self-start'}`}>
            <View className={`rounded-2xl px-3.5 py-2.5 ${m.role === 'user' ? 'bg-primary rounded-ee-md' : 'bg-surface2 rounded-es-md'}`}>
              {m.image ? <Image source={{ uri: m.image }} style={{ width: 200, height: 140, borderRadius: 12, marginBottom: m.text ? 8 : 0 }} contentFit="cover" /> : null}
              {m.text ? <Txt className={`text-[15px] leading-[22px] ${m.role === 'user' ? 'text-onprimary' : ''}`}>{m.text}</Txt> : null}
            </View>
          </Animated.View>
        )}
        ListFooterComponent={busy ? <View className="self-start bg-surface2 rounded-2xl px-4 py-3.5 flex-row gap-1.5 items-center"><Dot d={0} /><Dot d={150} /><Dot d={300} /></View> : null}
      />
      {image ? (
        <View className="px-4 pb-2 flex-row"><View><Image source={{ uri: image }} style={{ width: 64, height: 64, borderRadius: 12 }} /><Pressable onPress={() => setImage('')} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-danger items-center justify-center"><Icon name="close" size={14} color="#fff" /></Pressable></View></View>
      ) : null}
      <View className="flex-row items-end gap-2 px-3 py-2.5">
        <View className="flex-1 flex-row items-end bg-surface2 rounded-3xl px-3 min-h-[48px]">
          <Pressable testID="chat-attach" onPress={() => setAttach(true)} className="h-12 w-9 items-center justify-center"><Icon name="image-plus" size={22} tone="muted" /></Pressable>
          <TextInput testID="chat-input" value={text} onChangeText={setText} placeholder={t('assistant.placeholder')} placeholderTextColor={colors.muted} multiline onSubmitEditing={send}
            style={{ flex: 1, color: colors.fg, fontSize: 16, maxHeight: 110, paddingVertical: 13, outlineStyle: 'none' } as any} />
        </View>
        <Pressable testID="chat-send" onPress={send} className={`w-12 h-12 rounded-full items-center justify-center ${text.trim() || image ? 'bg-primary' : 'bg-surface2'}`}>
          <Icon name="arrow-up" size={22} tone={text.trim() || image ? 'onprimary' : 'muted'} />
        </Pressable>
      </View>
      <Sheet visible={attach} onClose={() => setAttach(false)} title={t('assistant.attach')}>
        <View className="flex-row gap-3">
          {(['camera', 'gallery'] as const).map((k) => (
            <Pressable key={k} onPress={() => pick(k)} className="flex-1 items-center py-6 rounded-2xl bg-surface2 active:opacity-70"><Icon name={k === 'camera' ? 'camera-outline' : 'image-multiple-outline'} size={30} /><Txt className="font-bold mt-2">{t(`wizard.${k}`)}</Txt></Pressable>
          ))}
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
