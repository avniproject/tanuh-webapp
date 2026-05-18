import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const PROXY_PREFIXES = [
  "/idp-details",
  "/api",
  "/me",
  "/web",
  "/media",
  "/cognito-details",
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_AVNI_PROXY_TARGET || env.VITE_AVNI_API_BASE_URL;

  return {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      port: 3010,
      proxy: proxyTarget
        ? Object.fromEntries(
            PROXY_PREFIXES.map((p) => [
              p,
              {
                target: proxyTarget,
                changeOrigin: true,
                secure: true,
              },
            ]),
          )
        : undefined,
    },
  };
});
