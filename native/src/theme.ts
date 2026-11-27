/** VantraRun brand tokens (v1). Dark-first: Ink background, Volt as the single accent.
 * Text and icons on Volt are always Ink. No other hues, gradients or glows.
 */
export const brand = {
  volt: '#C6FF00',
  /** Volt at reduced strength, same hue. Only for ramps (zone 4), never as a second accent. */
  voltDim: '#9FCC00',
  ink: '#0B0B0C',
  graphite: '#1C1C1F',
  line: '#2A2A2F',
  steel: '#8A8A93',
  text2: '#A6A6AE',
  chalk: '#F5F5F2',
  danger: '#FF4D4D',
};

export const colors = {
  background: brand.ink,
  panel: brand.graphite,
  panelBorder: brand.line,
  text: brand.chalk,
  muted: brand.text2,
  subtle: brand.steel,
  accent: brand.volt,
  accentText: brand.ink,
  danger: brand.danger,
  dangerBg: brand.graphite,
  /** Fill behind a selected row or choice; the Volt border carries the selection. */
  selectedBg: brand.line,
  /** Warnings and "out of zone" are neutral: Chalk text, with their wording or symbol. */
  notice: brand.chalk,
  /** Planned route under the Volt track: Chalk at 60%. */
  routePlanned: 'rgba(245, 245, 242, 0.6)',
};
