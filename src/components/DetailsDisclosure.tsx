import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';

import { useThemeColors } from '../contexts/ThemeContext';
import { createDetailsDisclosureStyles } from '../styles/DetailsDisclosure.styles';

// The link itself is ~26 dp tall; widen the touch target toward 44 dp.
const HIT_SLOP = { top: 10, bottom: 10, left: 8, right: 8 };

interface Props {
  /** Link text, e.g. "Details" / "Privacy details". */
  label: string;
  /** The link's testID; the expanded body is `${testID}-body`. */
  testID: string;
  /** One string per paragraph; falsy entries are skipped. */
  paragraphs: (string | false | null | undefined)[];
}

/**
 * A small "▸ Details" link that expands to the fine print under a settings
 * section — keeps each section to one line of copy while every fact the user
 * should be able to read before opting in stays one tap away. Collapsed by
 * default.
 */
const DetailsDisclosure: React.FC<Props> = ({ label, testID, paragraphs }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createDetailsDisclosureStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <>
      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setOpen((v) => !v)}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        testID={testID}
      >
        <Chevron size={16} color={colors.white} />
        <Text style={styles.toggleText}>{label}</Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.body} testID={`${testID}-body`}>
          {paragraphs.filter(Boolean).map((p, i) => (
            <Text key={i} style={styles.paragraph}>
              {p}
            </Text>
          ))}
        </View>
      )}
    </>
  );
};

export default DetailsDisclosure;
