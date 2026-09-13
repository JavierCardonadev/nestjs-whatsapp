import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC emits decorator metadata, which class-validator and NestJS rely on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts'],
    setupFiles: ['reflect-metadata'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/core/index.ts', 'src/core/types.ts', 'src/nest/interfaces.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
