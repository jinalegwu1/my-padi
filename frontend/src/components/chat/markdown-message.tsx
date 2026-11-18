import { memo } from 'react';
import { Text } from 'react-native';
import Markdown, { MarkdownIt, type RenderRules } from 'react-native-markdown-display';

import { fonts, spacing, useColors, useType } from '@/constants/theme';

// Keep replies as native text. Image content uses the app's existing visual
// blocks rather than loading model-generated remote image URLs.
const parser = new MarkdownIt({ html: false, breaks: true }).disable('image');
const rules: RenderRules = {
  text: (node, _children, _parents, styles, inheritedStyles = {}) => (
    <Text key={node.key} selectable style={[inheritedStyles, styles.text]}>
      {node.content}
    </Text>
  ),
};

export const MarkdownMessage = memo(function MarkdownMessage({ text }: { text: string }) {
  const colors = useColors();
  const type = useType();
  const heading = { fontFamily: fonts.bold, marginTop: spacing.sm, marginBottom: spacing.xs };
  const code = {
    color: colors.padiBubbleText,
    backgroundColor: colors.cardMuted,
    borderColor: colors.border,
    fontSize: type.bodySmall,
    lineHeight: type.lineHeight(type.bodySmall),
  };

  return (
    <Markdown
      markdownit={parser}
      rules={rules}
      onLinkPress={(url) => /^https?:\/\//i.test(url)}
      style={{
        body: {
          color: colors.padiBubbleText,
          fontFamily: fonts.regular,
          fontSize: type.body,
          lineHeight: type.lineHeight(type.body),
          flexShrink: 1,
        },
        strong: { fontFamily: fonts.bold, fontWeight: 'normal' },
        paragraph: { marginTop: spacing.xs, marginBottom: spacing.xs },
        heading1: { ...heading, fontSize: type.heading },
        heading2: { ...heading, fontSize: type.subheading },
        heading3: { ...heading, fontSize: type.body },
        heading4: { ...heading, fontSize: type.body },
        heading5: { ...heading, fontSize: type.body },
        heading6: { ...heading, fontSize: type.body },
        list_item: { marginVertical: spacing.xs },
        bullet_list_icon: { marginLeft: 0, marginRight: spacing.sm },
        ordered_list_icon: { marginLeft: 0, marginRight: spacing.sm },
        code_inline: code,
        code_block: code,
        fence: code,
        blockquote: { backgroundColor: colors.cardMuted, borderColor: colors.borderStrong },
        hr: { backgroundColor: colors.border },
        link: { color: colors.primary },
        table: { borderColor: colors.border },
        tr: { borderColor: colors.border },
      }}>
      {text}
    </Markdown>
  );
});
