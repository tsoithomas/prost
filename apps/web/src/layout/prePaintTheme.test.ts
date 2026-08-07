import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_SIZE_PX } from '@prost/ui';
import { FONT_SIZES } from '@prost/shared-types';

/**
 * `index.html` applies the saved font size before React boots, to avoid a reflow — which means it
 * duplicates `FONT_SIZE_PX` as an inline literal that no type checker can reach. If the scale grows
 * and the script isn't updated, the new sizes silently fall back to the 16px default for one paint.
 */
describe('pre-paint theme script', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

  it('maps exactly the font sizes the app offers, at the same pixel values', () => {
    const literal = /var fontPx = \{([^}]*)\}/.exec(html)?.[1];
    expect(literal).toBeDefined();

    const inline = Object.fromEntries(
      literal!
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [key, value] = entry.split(':').map((part) => part.trim());
          return [key, value!.replace(/'/g, '')];
        }),
    );

    expect(inline).toEqual(FONT_SIZE_PX);
    expect(Object.keys(inline).sort()).toEqual([...FONT_SIZES].sort());
  });
});
