import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Without vitest's `globals: true` (deliberately off, see vite.config.js),
// @testing-library/react can't auto-detect a global afterEach to register
// its DOM cleanup, so each test file's renders would leak into the next.
afterEach(cleanup)

