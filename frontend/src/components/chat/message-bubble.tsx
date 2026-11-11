import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PadiAvatar } from '@/components/padi-avatar';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { VISUALS } from '@/data/visuals';
import { formatClock } from '@/lib/date';
import type { Message, VisualBlock } from '@/types';

type Props = {
  message: Message;
  /** Shown under a voice-session message. */
  voiceLabel?: string;
};

/** One message in the conversation. PADI on the start side, the user on the end side. */
export const MessageBubble = memo(function MessageBubble({ message, voiceLabel }: Props) {
  const colors = useColors();
  const type = useType();
  const isUser = message.role === 'user';

  if (message.pending) {
    return (
      <View style={styles.rowStart}>
        <PadiAvatar size={30} style={styles.avatar} />
        <View
          accessibilityLabel="PADI is typing"
          style={[
            styles.bubble,
            styles.padiBubble,
            { backgroundColor: colors.padiBubble, borderColor: colors.border },
          ]}>
          <TypingDots />
        </View>
      </View>
    );
  }

  return (
    <View style={isUser ? styles.rowEnd : styles.rowStart}>
      {!isUser ? <PadiAvatar size={30} style={styles.avatar} /> : null}
      <View style={styles.column}>
        <View
          style={[
            styles.bubble,
            isUser ? styles.userBubble : styles.padiBubble,
            {
              backgroundColor: isUser ? colors.userBubble : colors.padiBubble,
              borderColor: isUser ? colors.userBubble : colors.border,
            },
          ]}>
          <Text
            selectable
            style={[
              styles.text,
              {
                color: isUser ? colors.userBubbleText : colors.padiBubbleText,
                fontSize: type.body,
                lineHeight: type.lineHeight(type.body),
              },
            ]}>
            {message.text}
          </Text>
        </View>

        {message.visual ? <VisualBlockView block={message.visual} /> : null}

        <View style={[styles.meta, isUser ? styles.metaEnd : styles.metaStart]}>
          {message.viaVoice ? (
            <View style={styles.voiceTag}>
              <Ionicons name="mic" size={11} color={colors.muted} />
              <Text style={[styles.metaText, { color: colors.muted, fontSize: type.micro }]}>
                {voiceLabel ?? 'Voice'}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.metaText, { color: colors.muted, fontSize: type.micro }]}>
            {formatClock(message.createdAt)}
          </Text>
        </View>
      </View>
    </View>
  );
});

/** Rich content PADI can show inside a conversation. */
function VisualBlockView({ block }: { block: VisualBlock }) {
  const colors = useColors();
  const type = useType();

  if (block.type === 'image') {
    const source = VISUALS[block.imageUrl];
    return (
      <View
        style={[
          styles.visualCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}>
        {source ? (
          <Image
            source={source}
            style={[styles.visualImage, { aspectRatio: block.aspectRatio ?? 1.6 }]}
            contentFit="cover"
            accessibilityLabel={block.title}
            transition={200}
          />
        ) : null}
        <View style={styles.visualBody}>
          <Text style={[styles.visualTitle, { color: colors.text, fontSize: type.bodySmall }]}>
            {block.title}
          </Text>
          <Text style={[styles.visualCaption, { color: colors.muted, fontSize: type.caption }]}>
            {block.caption}
          </Text>
        </View>
      </View>
    );
  }

  if (block.type === 'steps') {
    return (
      <View
        style={[styles.visualCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.visualBody}>
          <Text style={[styles.visualTitle, { color: colors.text, fontSize: type.bodySmall }]}>
            {block.title}
          </Text>
          {block.caption ? (
            <Text style={[styles.visualCaption, { color: colors.muted, fontSize: type.caption }]}>
              {block.caption}
            </Text>
          ) : null}
          <View style={styles.stepList}>
            {block.steps.map((step, index) => (
              <View key={step.title} style={styles.stepRow}>
                <View style={[styles.stepIndex, { backgroundColor: colors.primarySoft }]}>
                  <Text
                    style={[styles.stepIndexText, { color: colors.primary, fontSize: type.micro }]}>
                    {index + 1}
                  </Text>
                </View>
                <View style={styles.stepText}>
                  <Text style={[styles.stepTitle, { color: colors.text, fontSize: type.bodySmall }]}>
                    {step.title.replace(/^\d+\.\s*/, '')}
                  </Text>
                  <Text
                    style={[styles.stepDetail, { color: colors.muted, fontSize: type.caption }]}>
                    {step.detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  if (block.type === 'list') {
    return (
      <View
        style={[styles.visualCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.visualBody}>
          <Text style={[styles.visualTitle, { color: colors.text, fontSize: type.bodySmall }]}>
            {block.title}
          </Text>
          {block.caption ? (
            <Text style={[styles.visualCaption, { color: colors.muted, fontSize: type.caption }]}>
              {block.caption}
            </Text>
          ) : null}
          <View style={styles.stepList}>
            {block.items.map((item) => (
              <View key={item} style={styles.bulletRow}>
                <View style={[styles.bullet, { backgroundColor: colors.accent }]} />
                <Text
                  style={[styles.bulletText, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
                  {item}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.visualCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.visualBody}>
        <Text style={[styles.visualTitle, { color: colors.text, fontSize: type.bodySmall }]}>
          {block.title}
        </Text>
        <View style={styles.diagramRow}>
          {block.nodes.map((node, index) => (
            <View key={node.label} style={styles.diagramNode}>
              <View
                style={[
                  styles.diagramCircle,
                  { backgroundColor: colors.primarySoft, borderColor: colors.primary },
                ]}>
                <Text style={[styles.diagramLabel, { color: colors.primary, fontSize: type.micro }]}>
                  {node.label}
                </Text>
              </View>
              {index < block.nodes.length - 1 ? (
                <Ionicons name="arrow-forward" size={14} color={colors.muted} />
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/** Three animated dots shown while PADI composes a reply. */
function TypingDots() {
  const colors = useColors();
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: colors.muted, opacity: 0.4 + i * 0.2 },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rowStart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingEnd: spacing.xxl,
  },
  rowEnd: { flexDirection: 'row', justifyContent: 'flex-end', paddingStart: spacing.xxl },
  avatar: { marginBottom: spacing.lg },
  column: { flexShrink: 1, gap: spacing.xs },
  bubble: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  padiBubble: { borderBottomStartRadius: 6 },
  userBubble: { borderBottomEndRadius: 6 },
  text: { fontFamily: fonts.regular },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaStart: { justifyContent: 'flex-start', paddingStart: spacing.xs },
  metaEnd: { justifyContent: 'flex-end', paddingEnd: spacing.xs },
  metaText: { fontFamily: fonts.medium },
  voiceTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  visualCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  visualImage: { width: '100%', backgroundColor: '#0A0F1E' },
  visualBody: { padding: spacing.md, gap: spacing.xs },
  visualTitle: { fontFamily: fonts.semibold },
  visualCaption: { fontFamily: fonts.regular, lineHeight: 17 },
  stepList: { gap: spacing.sm, marginTop: spacing.xs },
  stepRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  stepIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndexText: { fontFamily: fonts.bold },
  stepText: { flex: 1, gap: 1 },
  stepTitle: { fontFamily: fonts.semibold },
  stepDetail: { fontFamily: fonts.regular, lineHeight: 17 },
  bulletRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  bulletText: { flex: 1, fontFamily: fonts.regular, lineHeight: 20 },
  diagramRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  diagramNode: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  diagramCircle: {
    minWidth: 54,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
  },
  diagramLabel: { fontFamily: fonts.semibold },
  dots: { flexDirection: 'row', gap: 5, paddingVertical: 4, paddingHorizontal: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
