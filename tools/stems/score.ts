// The stand-in score the two composed stems are rendered from (design doc §13).
//
// D minor, 60 BPM, so a beat is a second. Eight chords of 12 s make a 96 s cycle that every stem
// shares, and the player starts them all on one clock, so the music box always sits on the
// choir's chord. Natural minor throughout, except the last chord: a suspended A that opens to A
// major for its final 6 s and leads back to Dm.

export const CYCLE = 96;
export const CHORD = 12;

/** A MIDI note held from `at` (seconds into the cycle) until the part's next entry. */
export type Entry = readonly [at: number, midi: number];

/** Bass, tenor, alto, soprano for each chord, MIDI. A part that keeps its pitch across a change holds the note. */
const VOICINGS: readonly (readonly [number, number, number, number])[] = [
  [50, 57, 65, 69], // Dm     D3 A3 F4 A4
  [46, 53, 62, 70], // Bb     Bb2 F3 D4 Bb4
  [43, 55, 62, 70], // Gm     G2 G3 D4 Bb4
  [45, 52, 60, 69], // Am     A2 E3 C4 A4
  [50, 53, 62, 69], // Dm     D3 F3 D4 A4
  [41, 53, 60, 69], // F      F2 F3 C4 A4
  [43, 55, 62, 70], // Gm     G2 G3 D4 Bb4
  [45, 52, 62, 69], // Asus4  A2 E3 D4 A4, the alto falls to C#4 at 90 s
];

export type Part = 'bass' | 'tenor' | 'alto' | 'soprano';
export const PARTS: readonly Part[] = ['bass', 'tenor', 'alto', 'soprano'];

/** Each part's line over one cycle, with repeated pitches merged into held notes. */
export const CHOIR: Record<Part, Entry[]> = Object.fromEntries(
  PARTS.map((part, p) => {
    const line: Entry[] = [];
    VOICINGS.forEach((v, i) => {
      if (line.at(-1)?.[1] !== v[p]) line.push([i * CHORD, v[p]]);
    });
    if (part === 'alto') line.push([90, 61]);
    return [part, line];
  }),
) as Record<Part, Entry[]>;

/** The choir's dynamic shape: a level per chord, swelling through the middle of each. */
export const CHOIR_LEVELS = [0.8, 0.85, 0.9, 0.78, 0.85, 1, 0.9, 0.8];

/** The vowel each chord is sung on: mostly an open "ah", darker "oh" on the minor v and the turn home. */
export const CHOIR_VOWELS: readonly ('a' | 'o')[] = ['a', 'a', 'a', 'o', 'a', 'a', 'a', 'o'];

/** [second, MIDI, velocity 0..1] */
export type Note = readonly [at: number, midi: number, vel: number];

/**
 * Three music-box variants of one cycle each, all on the same chords. The player picks a different
 * one each time round. Every variant is silent for its last 6 s, so any can follow any.
 */
export const MUSIC_BOX: Record<string, Note[]> = {
  // The theme: a rising figure that settles, answered higher the second time.
  a: [
    // Dm
    [0.5, 62, 0.5], [1, 69, 0.7], [2, 74, 0.8], [2.5, 76, 0.6], [3, 77, 0.9], [5, 76, 0.6], [5.5, 74, 0.5], [6, 72, 0.6], [7, 74, 0.8], [8, 62, 0.4],
    // Bb
    [12.5, 65, 0.45], [13, 74, 0.7], [14, 77, 0.8], [14.5, 79, 0.6], [15, 81, 0.9], [17, 79, 0.6], [18, 77, 0.7], [19, 74, 0.6], [21, 65, 0.4],
    // Gm
    [24.5, 67, 0.45], [25, 70, 0.6], [26, 74, 0.7], [27, 79, 0.8], [29, 77, 0.6], [29.5, 76, 0.5], [30, 74, 0.7], [32, 70, 0.5], [33, 69, 0.6],
    // Am
    [36.5, 64, 0.45], [37, 72, 0.6], [38, 76, 0.8], [40, 74, 0.6], [40.5, 72, 0.5], [41, 69, 0.7], [44, 64, 0.4],
    // Dm
    [48.5, 62, 0.5], [49, 69, 0.7], [50, 74, 0.8], [50.5, 76, 0.6], [51, 77, 0.9], [53, 81, 0.8], [54, 79, 0.6], [54.5, 77, 0.5], [55, 76, 0.7], [57, 74, 0.6],
    // F
    [60.5, 65, 0.45], [61, 72, 0.6], [62, 77, 0.7], [63, 81, 0.8], [64, 84, 0.9], [66, 81, 0.6], [67, 79, 0.6], [68, 77, 0.7], [69.5, 72, 0.4],
    // Gm
    [72.5, 67, 0.45], [73, 82, 0.8], [74, 81, 0.6], [75, 79, 0.7], [76, 74, 0.6], [78, 76, 0.5], [78.5, 77, 0.5], [79, 79, 0.7], [81, 74, 0.5],
    // Asus4
    [84.5, 69, 0.5], [85, 76, 0.6], [86, 74, 0.7], [88, 69, 0.5],
  ],
  // Lower and hesitant, with the comb's bass teeth on each chord.
  b: [
    [0.5, 62, 0.55], [2, 77, 0.7], [3.5, 76, 0.55], [4, 74, 0.6], [6, 69, 0.65], [8, 74, 0.5], [9.5, 72, 0.45], [10, 74, 0.55],
    [12.5, 58, 0.55], [14, 74, 0.7], [15.5, 72, 0.5], [16, 70, 0.6], [18, 77, 0.7], [20, 74, 0.55],
    [24.5, 55, 0.55], [26, 70, 0.6], [27, 74, 0.65], [28, 79, 0.75], [30, 77, 0.55], [31, 74, 0.6], [33, 76, 0.45],
    [36.5, 57, 0.55], [38, 72, 0.6], [39, 76, 0.7], [41, 81, 0.75], [43, 79, 0.5], [44, 76, 0.55],
    [48.5, 62, 0.55], [50, 81, 0.7], [51.5, 79, 0.5], [52, 77, 0.6], [54, 74, 0.65], [56, 76, 0.5], [57, 77, 0.55],
    [60.5, 65, 0.5], [62, 81, 0.7], [63, 79, 0.55], [64, 81, 0.7], [66, 77, 0.6], [68, 72, 0.55], [69, 76, 0.4], [70, 77, 0.5],
    [72.5, 67, 0.5], [74, 74, 0.6], [75, 70, 0.55], [76, 67, 0.6], [78, 69, 0.5], [79, 70, 0.55], [80, 74, 0.65], [82, 72, 0.45],
    [84.5, 57, 0.5], [85.5, 74, 0.55], [86.5, 76, 0.5], [88, 69, 0.45],
  ],
  // High, glassy fragments with long rests between them.
  c: [
    [1, 81, 0.6], [2, 86, 0.7], [5, 89, 0.55], [6, 88, 0.5], [7, 86, 0.6],
    [14, 86, 0.6], [15, 84, 0.5], [16, 82, 0.6], [19, 77, 0.55],
    [26, 79, 0.6], [27, 82, 0.6], [28, 86, 0.65], [31, 81, 0.5],
    [38, 88, 0.6], [39, 84, 0.55], [40, 81, 0.6], [43, 76, 0.5],
    [50, 89, 0.6], [51, 88, 0.5], [52, 86, 0.6], [53, 81, 0.55], [56, 74, 0.5],
    [62, 84, 0.6], [63, 81, 0.55], [64, 77, 0.6], [67, 79, 0.5], [68, 81, 0.55],
    [74, 82, 0.6], [75, 81, 0.5], [76, 79, 0.6], [79, 86, 0.55],
    [85, 88, 0.5], [86, 86, 0.55], [87.5, 81, 0.5],
  ],
};
