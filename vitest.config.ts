import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so tests don't load vite-plugin-mkcert, which calls
// the GitHub API to fetch mkcert and fails when rate-limited.
export default defineConfig({});
