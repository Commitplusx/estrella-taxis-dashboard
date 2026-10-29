import { trackingRuntime } from '../_shared/tracking/runtime.ts';
import { createScoresHandler } from './handler.ts';
if (import.meta.main) Deno.serve(createScoresHandler(trackingRuntime()));
