import { trackingRuntime } from '../_shared/tracking/runtime.ts';
import { createInsightsHandler } from './handler.ts';
if (import.meta.main) Deno.serve(createInsightsHandler(trackingRuntime()));
