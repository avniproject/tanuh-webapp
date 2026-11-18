/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AVNI_API_BASE_URL: string;
  readonly VITE_DQS_API_BASE_URL?: string;
  readonly VITE_DQS_TENANT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.svg" {
  const src: string;
  export default src;
}
