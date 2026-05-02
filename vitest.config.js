import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only test the public source tree. External plugins under `plugins/`
    // are bring-your-own and run their own tests separately if they have any.
    include: ['src/**/*.test.js'],
    exclude: ['node_modules/**', 'plugins/**'],
    watch: false,
  },
});
