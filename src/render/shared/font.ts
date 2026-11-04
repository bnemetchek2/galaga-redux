/**
 * A 5x7 bitmap font.
 *
 * The arcade original draws every character from a glyph ROM; this is the same
 * idea, authored by hand so the classic view can render crisp integer-scaled
 * text without loading a webfont.
 */

const GLYPH_SRC = `
A 01110 10001 10001 11111 10001 10001 10001
B 11110 10001 10001 11110 10001 10001 11110
C 01110 10001 10000 10000 10000 10001 01110
D 11110 10001 10001 10001 10001 10001 11110
E 11111 10000 10000 11110 10000 10000 11111
F 11111 10000 10000 11110 10000 10000 10000
G 01110 10001 10000 10111 10001 10001 01111
H 10001 10001 10001 11111 10001 10001 10001
I 11111 00100 00100 00100 00100 00100 11111
J 00111 00010 00010 00010 00010 10010 01100
K 10001 10010 10100 11000 10100 10010 10001
L 10000 10000 10000 10000 10000 10000 11111
M 10001 11011 10101 10101 10001 10001 10001
N 10001 11001 10101 10011 10001 10001 10001
O 01110 10001 10001 10001 10001 10001 01110
P 11110 10001 10001 11110 10000 10000 10000
Q 01110 10001 10001 10001 10101 10010 01101
R 11110 10001 10001 11110 10100 10010 10001
S 01111 10000 10000 01110 00001 00001 11110
T 11111 00100 00100 00100 00100 00100 00100
U 10001 10001 10001 10001 10001 10001 01110
V 10001 10001 10001 10001 10001 01010 00100
W 10001 10001 10001 10101 10101 11011 10001
X 10001 10001 01010 00100 01010 10001 10001
Y 10001 10001 01010 00100 00100 00100 00100
Z 11111 00001 00010 00100 01000 10000 11111
0 01110 10001 10011 10101 11001 10001 01110
1 00100 01100 00100 00100 00100 00100 01110
2 01110 10001 00001 00010 00100 01000 11111
3 11110 00001 00001 01110 00001 00001 11110
4 00010 00110 01010 10010 11111 00010 00010
5 11111 10000 11110 00001 00001 10001 01110
6 00110 01000 10000 11110 10001 10001 01110
7 11111 00001 00010 00100 01000 01000 01000
8 01110 10001 10001 01110 10001 10001 01110
9 01110 10001 10001 01111 00001 00010 01100
SPACE 00000 00000 00000 00000 00000 00000 00000
- 00000 00000 00000 11111 00000 00000 00000
. 00000 00000 00000 00000 00000 01100 01100
, 00000 00000 00000 00000 01100 01100 11000
: 00000 01100 01100 00000 01100 01100 00000
! 00100 00100 00100 00100 00100 00000 00100
? 01110 10001 00001 00110 00100 00000 00100
' 00100 00100 00000 00000 00000 00000 00000
/ 00001 00010 00010 00100 01000 01000 10000
( 00010 00100 01000 01000 01000 00100 00010
) 01000 00100 00010 00010 00010 00100 01000
+ 00000 00100 00100 11111 00100 00100 00000
> 01000 00100 00010 00001 00010 00100 01000
< 00010 00100 01000 10000 01000 00100 00010
* 00000 10101 01110 11111 01110 10101 00000
`;

export const GLYPH_W = 5;
export const GLYPH_H = 7;
export const GLYPH_ADVANCE = 6;

const GLYPHS = new Map<string, Uint8Array>();

for (const rawLine of GLYPH_SRC.split('\n')) {
  const line = rawLine.trim();
  if (!line) continue;
  const [name, ...rows] = line.split(/\s+/);
  const data = new Uint8Array(GLYPH_W * GLYPH_H);
  rows.forEach((row, y) => {
    for (let x = 0; x < GLYPH_W; x++) {
      if (row[x] === '1') data[y * GLYPH_W + x] = 1;
    }
  });
  GLYPHS.set(name === 'SPACE' ? ' ' : name, data);
}

const FALLBACK = GLYPHS.get('?')!;

export function glyphFor(char: string): Uint8Array {
  return GLYPHS.get(char.toUpperCase()) ?? FALLBACK;
}

/** Width in logical pixels of a string rendered at `scale`. */
export function measureText(text: string, scale = 1, tracking = 1): number {
  if (text.length === 0) return 0;
  return (text.length * (GLYPH_W + tracking) - tracking) * scale;
}

export interface TextOptions {
  color?: string;
  scale?: number;
  align?: 'left' | 'center' | 'right';
  tracking?: number;
  shadow?: string | null;
}

/**
 * Draw bitmap text. Uses integer pixel rects so it stays razor sharp at any
 * integer scale.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: TextOptions = {},
): void {
  const {
    color = '#ffffff',
    scale = 1,
    align = 'left',
    tracking = 1,
    shadow = null,
  } = options;
  const width = measureText(text, scale, tracking);
  let cursor = align === 'left' ? x : align === 'center' ? x - width / 2 : x - width;
  cursor = Math.round(cursor);
  const top = Math.round(y);

  const pass = (ox: number, oy: number, fill: string) => {
    ctx.fillStyle = fill;
    let cx = cursor + ox;
    for (const char of text) {
      const glyph = glyphFor(char);
      for (let gy = 0; gy < GLYPH_H; gy++) {
        for (let gx = 0; gx < GLYPH_W; gx++) {
          if (!glyph[gy * GLYPH_W + gx]) continue;
          ctx.fillRect(cx + gx * scale, top + oy + gy * scale, scale, scale);
        }
      }
      cx += (GLYPH_W + tracking) * scale;
    }
  };

  if (shadow) pass(scale, scale, shadow);
  pass(0, 0, color);
}
