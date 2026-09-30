import { createClient } from "npm:@supabase/supabase-js@2";
Deno.serve(async (req) => {
  const secret = Deno.env.get("CLEANUP_SECRET");
  if (!secret || req.headers.get("Authorization") !== `Bearer ${secret}`)
    return new Response("Unauthorized", { status: 401 });
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let removed = 0;
  try {
    for (let page = 1; ; page++) {
      const { data: users, error } = await db.auth.admin.listUsers({
        page,
        perPage: 100,
      });
      if (error) throw error;
      for (const u of users.users) {
        // Gather paths before deletion so paging cannot skip entries as objects disappear.
        const candidates: string[] = [];
        for (let offset = 0; ; offset += 100) {
          const { data: objects, error } = await db.storage
            .from("receipts")
            .list(u.id, {
              limit: 100,
              offset,
              sortBy: { column: "name", order: "asc" },
            });
          if (error) throw error;
          for (const o of objects || [])
            if (new Date(o.created_at).getTime() < cutoff)
              candidates.push(`${u.id}/${o.name}`);
          if (!objects || objects.length < 100) break;
        }
        for (const path of candidates) {
          const { data: claimed, error } = await db.rpc(
            "claim_receipt_cleanup",
            { p_owner: u.id, p_path: path },
          );
          if (error) throw error;
          if (!claimed) continue;
          const { error: removeError } = await db.storage
            .from("receipts")
            .remove([path]);
          if (removeError) throw removeError;
          const { error: clearError } = await db
            .from("receipt_gc")
            .delete()
            .eq("path", path);
          if (clearError) throw clearError;
          removed++;
        }
      }
      if (users.users.length < 100) break;
    }
    return Response.json({ removed });
  } catch {
    return new Response("Cleanup failed; retry on the next scheduled run.", {
      status: 500,
    });
  }
});
