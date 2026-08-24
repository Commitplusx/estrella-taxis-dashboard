import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://knghdwpxheenkpuajkxl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuZ2hkd3B4aGVlbmtwdWFqa3hsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MTQ5ODgsImV4cCI6MjEwMDk5MDk4OH0.GYTrjUjrbbcBsZHTPbD5GrPub1ZOoFCe8JuNF9SQoMA';

export const supabase = createClient(supabaseUrl, supabaseKey);
