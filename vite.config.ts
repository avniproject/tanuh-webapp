import { defineConfig, loadEnv, type ProxyOptions } from "vite";
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
  // The data quality service, a separate service, under /dqs; the prefix is dropped on the way.
  const dqsTarget = env.VITE_DQS_PROXY_TARGET;
  const dqsProxy: Record<string, ProxyOptions> = dqsTarget
    ? {
        "/dqs": {
          target: dqsTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (p: string) => p.replace(/^\/dqs/, ""),
        },
      }
    : {};

  return {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      port: 3010,
      proxy: {
        ...(proxyTarget
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
          : {}),
        ...dqsProxy,
      },
    },
  };
});
