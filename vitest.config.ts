import {defineConfig} from 'vitest/config';

// Observed road-graph integration tests load several large regional models.
// Bound concurrency to avoid resource-dependent timeouts on local machines.
export default defineConfig({test:{maxWorkers:2,testTimeout:30000}});
