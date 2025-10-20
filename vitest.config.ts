import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'worker': path.resolve(__dirname, './worker'),
      'shared': path.resolve(__dirname, './shared'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/src/**/*.{test,spec}.{js,ts,jsx,tsx}', '**/worker/**/*.{test,spec}.{js,ts}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/routes/chat/hooks/use-chat.ts',
        'src/routes/chat/utils/handle-websocket-message.ts',
        'src/routes/chat/chat.tsx',
      ],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
      ],
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
    },
  },
});