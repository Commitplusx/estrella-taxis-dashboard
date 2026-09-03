import * as postgres from "https://deno.land/x/postgres@v0.17.0/mod.ts";

Deno.serve(async (req) => {
  try {
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) throw new Error("No SUPABASE_DB_URL");
    
    const pool = new postgres.Pool(dbUrl, 3, true);
    const connection = await pool.connect();
    
    const result = await connection.queryObject`
      SELECT proname, prosrc 
      FROM pg_proc 
      WHERE prosrc ILIKE '%FRAUDE DE GEOCERCA%';
    `;
    
    if (result.rows.length > 0) {
      const funcName = (result.rows[0] as any).proname;
      await connection.queryObject(`
        CREATE OR REPLACE FUNCTION ${funcName}()
        RETURNS TRIGGER AS $$
        BEGIN
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      connection.release();
      return new Response(`Disabled function ${funcName}`, { status: 200 });
    }
    
    connection.release();
    return new Response(JSON.stringify(result.rows, null, 2), { status: 200 });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});
