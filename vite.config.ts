import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  server: { port: 5173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'] },
});
