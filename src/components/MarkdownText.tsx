import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useSafeExternalLink } from '../hooks/useSafeExternalLink';
import {
  parseMarkdown,
  truncateBlocks,
  type MdBlock,
  type MdInline,
} from '../utils/marketMarkdown';
import { createMarkdownTextStyles, type MarkdownTextStyles } from '../styles/MarkdownText.styles';

interface Props {
  markdown: string;
  testID: string;
  /** Text budget before "Show more" (whole blocks). */
  collapsedChars?: number;
}

type OpenLink = (url: string) => void;

function Inlines({
  runs,
  styles,
  onLink,
  testID,
}: {
  runs: MdInline[];
  styles: MarkdownTextStyles;
  onLink: OpenLink;
  testID: string;
}) {
  return (
    <>
      {runs.map((run, i) => {
        const style = [
          run.bold && styles.bold,
          run.italic && styles.italic,
          run.strike && styles.strike,
          run.code && styles.code,
          run.href && styles.link,
        ];
        return run.href ? (
          <Text
            key={i}
            style={style}
            onPress={() => onLink(run.href!)}
            accessibilityRole="link"
            testID={`${testID}-link-${i}`}
          >
            {run.text}
          </Text>
        ) : (
          <Text key={i} style={style}>
            {run.text}
          </Text>
        );
      })}
    </>
  );
}

function Blocks({
  blocks,
  styles,
  onLink,
  testID,
}: {
  blocks: MdBlock[];
  styles: MarkdownTextStyles;
  onLink: OpenLink;
  testID: string;
}) {
  return (
    <>
      {blocks.map((block, i) => {
        const id = `${testID}-${i}`;
        switch (block.type) {
          case 'paragraph':
            return (
              <Text key={i} style={styles.paragraph}>
                <Inlines runs={block.inlines} styles={styles} onLink={onLink} testID={id} />
              </Text>
            );
          case 'heading':
            return (
              <Text key={i} style={styles[`h${block.level}`]} accessibilityRole="header">
                <Inlines runs={block.inlines} styles={styles} onLink={onLink} testID={id} />
              </Text>
            );
          case 'code':
            return (
              <Text key={i} style={styles.codeBlock}>
                {block.text}
              </Text>
            );
          case 'quote':
            return (
              <View key={i} style={styles.quote}>
                <Blocks blocks={block.blocks} styles={styles} onLink={onLink} testID={id} />
              </View>
            );
          case 'list':
            return (
              <View key={i} style={styles.list}>
                {block.items.map((item, n) => (
                  <View key={n} style={styles.listItem}>
                    <Text style={styles.bullet}>{block.ordered ? `${block.start + n}.` : '•'}</Text>
                    <View style={styles.listItemBody}>
                      <Blocks blocks={item} styles={styles} onLink={onLink} testID={`${id}-${n}`} />
                    </View>
                  </View>
                ))}
              </View>
            );
        }
      })}
    </>
  );
}

/**
 * A listing description rendered as Markdown (NIP-99 / Gamma Markets
 * `content`) using the safe subset from `utils/marketMarkdown`. Links ask
 * before leaving the app; long descriptions collapse behind "Show more".
 */
const MarkdownText: React.FC<Props> = ({ markdown, testID, collapsedChars = 700 }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarkdownTextStyles(colors), [colors]);
  const all = useMemo(() => parseMarkdown(markdown), [markdown]);
  const collapsed = useMemo(() => truncateBlocks(all, collapsedChars), [all, collapsedChars]);
  const [expanded, setExpanded] = useState(false);

  const onLink = useSafeExternalLink();

  if (all.length === 0) return null;
  const shown = expanded ? all : collapsed.blocks;
  return (
    <View style={styles.container} testID={testID}>
      <Blocks blocks={shown} styles={styles} onLink={onLink} testID={testID} />
      {collapsed.truncated ? (
        <TouchableOpacity
          onPress={() => setExpanded((e) => !e)}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? t('market.markdown.showLess') : t('market.markdown.showMore')
          }
          testID={`${testID}-toggle`}
        >
          <Text style={styles.more}>
            {expanded ? t('market.markdown.showLess') : t('market.markdown.showMore')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

export default React.memo(MarkdownText);
