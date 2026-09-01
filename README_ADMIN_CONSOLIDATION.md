# Admin Core Backend Consolidation

Core Admin mutations are routed through `src/services/adminCore.service.ts` and server-side RPCs. Sensitive mutations enforce admin authorization and write audit records. The Core Admin page uses optimistic updates with rollback and Supabase Realtime refresh for core tables.
