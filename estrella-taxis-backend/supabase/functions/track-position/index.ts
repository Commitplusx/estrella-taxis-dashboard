import { trackingRuntime } from '../_shared/tracking/runtime.ts';
import { createTrackPositionHandler } from './handler.ts';

const runtime = trackingRuntime();
Deno.serve(createTrackPositionHandler({
  store: runtime.store,
  fleet: runtime.fleet,
  fetcher: runtime.fetcher,
  email: runtime.job.email,
  password: runtime.job.password,
}));
