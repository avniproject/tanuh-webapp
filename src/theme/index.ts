import { createTheme } from "@mui/material/styles";

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
});
