// The Clinician Review design ("Clinician Review v3 - TANUH"): the colours, radii and font of the
// programme shell and the Breast Cancer Screening screens. Used in `sx` props; the app's MUI theme
// stays as the oral review screens were built on it.

export const CR = {
  font: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  page: "#e9f7f6",
  surface: "#ffffff",
  text: "#12262a",
  textSecondary: "#53676a",
  textTertiary: "#32474a",
  textMuted: "#9fb4b6",
  brand: "#168a8d",
  brandPressed: "#10686b",
  heading: "#13797c",
  border: "#d9e8e8",
  inputBorder: "#c3d8d8",
  divider: "#e4f1f1",
  tableHead: "#f2f8f8",
  hover: "#f6fbfb",
  selected: "#e1f4f3",
  navHover: "#eef7f7",
  segment: "#d6ecea",
  headerFrom: "#11303a",
  headerTo: "#123f42",
  avatar: "#4fc2a2",
  avatarText: "#0f3b40",
  error: "#b42323",
  errorSubtle: "#fdecec",
  shadow: "0 10px 30px rgba(15,59,64,.16)",
  radius: { card: "22px", panel: "16px", pill: "999px" },
} as const;

export type Tone = "high" | "low" | "submitted" | "draft" | "idle";

/** Background and text of a status pill. */
export const TONES: Record<Tone, { bg: string; fg: string }> = {
  high: { bg: "#fde3e1", fg: "#9b2a20" },
  low: { bg: "#dff3e8", fg: "#17603b" },
  submitted: { bg: "#dff3e8", fg: "#17603b" },
  draft: { bg: "#fff4e0", fg: "#8a5a00" },
  idle: { bg: "#e4f1f1", fg: "#53676a" },
};

/** The base text style of a Clinician Review screen. */
export const crText = { fontFamily: CR.font, color: CR.text } as const;
