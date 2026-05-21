import { createTheme } from "@mui/material/styles";

// Read-only completed reviews use MUI's `disabled` state on every input, which
// renders text at ~38% opacity. That's invisible to physicians reviewing their
// past work. These overrides keep the disabled fields dark enough to read at a
// glance while still signalling non-editable via the underlying border styles.
const READONLY_TEXT = "rgba(0,0,0,0.87)";
const READONLY_LABEL = "rgba(0,0,0,0.7)";

export const theme = createTheme({
  palette: {
    primary: { main: "#2563eb" },
    secondary: { main: "#64748b" },
    background: { default: "#f3f4f6" },
  },
  typography: {
    fontFamily: ["-apple-system", "BlinkMacSystemFont", "Inter", "Segoe UI", "Roboto", "sans-serif"].join(","),
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 6 },
  components: {
    // Stop SHOUTING. MUI default uppercases all button labels which clashes
    // with the rest of the (sentence-case) UI.
    MuiButton: {
      styleOverrides: {
        root: { textTransform: "none" },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        input: {
          "&.Mui-disabled": {
            WebkitTextFillColor: READONLY_TEXT,
            color: READONLY_TEXT,
          },
        },
      },
    },
    MuiFormLabel: {
      styleOverrides: {
        root: {
          "&.Mui-disabled": { color: READONLY_LABEL },
        },
      },
    },
    MuiFormControlLabel: {
      styleOverrides: {
        label: {
          "&.Mui-disabled": { color: READONLY_TEXT },
        },
      },
    },
    MuiRadio: {
      styleOverrides: {
        root: {
          // Unchecked + disabled — faint ring so it's clear it's there but
          // not active.
          "&.Mui-disabled": { color: "rgba(0,0,0,0.3)" },
          // Checked + disabled — dark grey so the selected verdict is
          // visible without screaming "interactive primary color".
          // !important needed to beat MUI's own disabled override.
          "&.Mui-checked.Mui-disabled": { color: "rgba(0,0,0,0.6) !important" },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          "&.Mui-disabled": {
            opacity: 1,
            color: READONLY_TEXT,
          },
        },
        label: {
          color: READONLY_TEXT,
          fontWeight: 500,
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        // When the whole Autocomplete is disabled (read-only review),
        // suppress the delete (×) icons on chips. The chip itself keeps its
        // label visible, but the × button disappears so the field stops
        // looking interactive.
        root: {
          "&.Mui-disabled .MuiChip-deleteIcon": { display: "none" },
        },
        option: {
          color: READONLY_TEXT,
          fontWeight: 500,
          fontSize: "0.95rem",
        },
        tag: {
          "&.Mui-disabled": {
            opacity: 1,
            color: READONLY_TEXT,
          },
        },
      },
    },
    // Subtle grey fill on every disabled outlined field — visually flags the
    // form as locked without making the values themselves unreadable.
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          "&.Mui-disabled": {
            backgroundColor: "rgba(0,0,0,0.035)",
          },
        },
      },
    },
    // Hide the dropdown caret on disabled Selects — it implies clickability.
    MuiSelect: {
      styleOverrides: {
        icon: {
          "&.Mui-disabled": { display: "none" },
        },
      },
    },
  },
});
