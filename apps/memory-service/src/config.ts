// TODO(#68): replace with full Zod schema + env loading
export const config = {
  HOST: process.env.HOST ?? "127.0.0.1",
  PORT: Number(process.env.PORT ?? 3001),
  DATA_DIR: process.env.DATA_DIR ?? "~/.lingcrawl",
} as const;