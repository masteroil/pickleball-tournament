import { defineConfig, loadEnv } from "vite";
import tailwind from "@tailwindcss/vite";
import { localDemo } from "./scripts/demo";
export default defineConfig(({ mode, command }) => ({
  base: "./",
  plugins: [
    tailwind(),
    ...(command === "serve" && !loadEnv(mode, process.cwd()).VITE_API_URL
      ? [localDemo()]
      : []),
  ],
  test: { include: ["tests/**/*.test.ts"] },
}));
