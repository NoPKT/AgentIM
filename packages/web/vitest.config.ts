import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Thresholds reflect current tested surface area (lib/ + stores/ + components/).
      // Pages have no unit tests by design (covered by E2E). Raise these as unit
      // test coverage grows.
      thresholds: {
        lines: 5,
        functions: 30,
        statements: 5,
        branches: 20,
      },
    },
  },
})
