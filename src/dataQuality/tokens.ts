// The colours of the Data Quality screens: the Tanuh design system's Figma variables, as the
// dqs-demo design names them. They are used in `sx` props here rather than in the app's MUI
// theme, whose primary colour belongs to the review screens.

export const DQ = {
  surface: "#ffffff",
  surfaceSubtle: "#f7f8f9",
  surfaceMuted: "#f1f2f4",
  surfaceDisabled: "#e3e6e9",
  segment: "#e8eaec",
  neutral: "#8d9399",
  brand: "#177277",
  brandPressed: "#155d62",
  brandSubtle: "#dcefef",
  brandSubtleHover: "#cfe8e8",
  danger: "#a31d1d",
  dangerSubtle: "#f4e1e1",
  success: "#2f9a4e",
  successText: "#1f7a3a",
  warning: "#9a5b06",
  warningSubtle: "#fdf1cc",
  text: "#1f2328",
  textMuted: "#555b62",
  textSubtle: "#686e75",
  textDisabled: "#8d9399",
  link: "#213a63",
  border: "#e3e6e9",
  borderStrong: "#555b62",
} as const;
