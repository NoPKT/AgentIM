import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    execArgv: ['--no-warnings'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Only measure coverage for tested surface area (lib/ + stores/ + components/ + hooks/).
      // Pages have no unit tests by design (covered by E2E). Explicit include prevents
      // vitest from pulling untested page files into the report and dropping thresholds.
      include: ['src/lib/**', 'src/stores/**', 'src/components/**', 'src/hooks/**'],
      all: false,
      thresholds: {
        lines: 28,
        functions: 25,
        statements: 27,
        branches: 16,
      },
    },
  },
})
