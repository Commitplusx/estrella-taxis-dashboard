-- Add caller_id to identify the user for Smart Resume
ALTER TABLE public.telnyx_active_calls 
ADD COLUMN caller_id TEXT;

-- Add confusion_count for Graceful Handover to human
ALTER TABLE public.telnyx_active_calls 
ADD COLUMN confusion_count INTEGER NOT NULL DEFAULT 0;

-- Create an index on caller_id and created_at to make Smart Resume fast
CREATE INDEX IF NOT EXISTS idx_telnyx_active_calls_caller_id_created_at 
ON public.telnyx_active_calls (caller_id, created_at DESC);
