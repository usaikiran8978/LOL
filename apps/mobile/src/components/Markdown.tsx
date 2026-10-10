import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/**
 * Renders the small Markdown subset used by admin-managed legal/CMS copy (headings, bullet lists, paragraphs,
 * **bold**). Content is rendered as plain text nodes — never as HTML — so CMS input cannot inject markup.
 */
export function Markdown({ source, testID }: { source: string; testID?: string }) {
  const { spacing } = useTheme();
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <View testID={testID}>
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
        if (heading) {
          return (
            <Text key={i} variant={heading[1]!.length <= 2 ? 'title' : 'heading'} style={{ marginTop: spacing.md, marginBottom: spacing.sm }}>
              {heading[2]}
            </Text>
          );
        }
        const lines = trimmed.split('\n');
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <View key={i} style={{ marginBottom: spacing.md }}>
              {lines.map((l, j) => (
                <Text key={j} style={{ marginBottom: spacing.xs }}>
                  {'•  '}
                  <Inline text={l.replace(/^\s*[-*]\s+/, '')} />
                </Text>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} style={{ marginBottom: spacing.md }}>
            <Inline text={lines.join(' ')} />
          </Text>
        );
      })}
    </View>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <Text key={i} style={{ fontWeight: '700' }}>
            {p.slice(2, -2)}
          </Text>
        ) : (
          p
        ),
      )}
    </>
  );
}
