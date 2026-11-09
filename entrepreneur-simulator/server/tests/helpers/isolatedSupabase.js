// Optional real Supabase acceptance backend. Never reads the application's .env.
// Only a separately provisioned disposable project is permitted.
const { createClient } = require("@supabase/supabase-js");
const { hash } = require("../../services/inspirationContract");
const OWNER = "nmdd-mcp-acceptance";
function isolatedConfiguration(env) {
  if (!env.NMDD_E2E_SUPABASE_URL) return null;
  const ref = env.NMDD_E2E_PROJECT_REF,
    url = new URL(env.NMDD_E2E_SUPABASE_URL);
  if (
    !ref ||
    ref === "vhbyauefgjhlfjbikdek" ||
    !/^[a-z]{20}$/.test(ref) ||
    url.origin !== `https://${ref}.supabase.co` ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    env.NMDD_E2E_CONFIRM_DISPOSABLE_PROJECT !== "yes" ||
    !env.NMDD_E2E_SERVICE_ROLE_KEY
  )
    throw new Error(
      "Acceptance requires an explicitly confirmed disposable Supabase project. The NMDD production project is prohibited.",
    );
  return { url: url.origin, key: env.NMDD_E2E_SERVICE_ROLE_KEY };
}
async function createIsolatedSupabase(env = process.env) {
  const config = isolatedConfiguration(env);
  if (!config) return null;
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const checked = async (promise) => {
    const result = await promise;
    if (result.error)
      throw new Error(
        "Disposable Supabase acceptance storage failed; check migrations and service key",
      );
    return result.data;
  };
  async function reset() {
    const clothing = await checked(
      client
        .from("wardrobe_items")
        .select("image_object_key")
        .eq("user_id", OWNER),
    );
    const pictures = await checked(
      client
        .from("wardrobe_inspiration_images")
        .select("object_key")
        .eq("owner_id", OWNER),
    );
    const grants = await checked(
      client
        .from("nmdd_oauth_grants")
        .select("client_id")
        .eq("owner_id", OWNER),
    );
    await checked(
      client.from("wardrobe_inspirations").delete().eq("owner_id", OWNER),
    );
    await checked(
      client.from("wardrobe_inspiration_images").delete().eq("owner_id", OWNER),
    );
    await checked(
      client.from("wardrobe_outfits").delete().eq("user_id", OWNER),
    );
    await checked(client.from("wardrobe_items").delete().eq("user_id", OWNER));
    await checked(
      client.from("nmdd_write_requests").delete().eq("owner_id", OWNER),
    );
    await checked(
      client.from("nmdd_tool_audit").delete().eq("owner_id", OWNER),
    );
    await checked(
      client.from("nmdd_oauth_grants").delete().eq("owner_id", OWNER),
    );
    const clientIds = [...new Set(grants.map((row) => row.client_id))];
    if (clientIds.length)
      await checked(
        client.from("nmdd_oauth_clients").delete().in("client_id", clientIds),
      );
    const prefix = hash(OWNER).slice(0, 24);
    const clothes = [
      ...new Set(clothing.map((row) => row.image_object_key)),
    ].filter((key) => key.startsWith(`${prefix}/`));
    const images = [...new Set(pictures.map((row) => row.object_key))].filter(
      (key) => key.startsWith(`inspirations/${prefix}/`),
    );
    if (clothes.length)
      await checked(client.storage.from("wardrobe-images").remove(clothes));
    if (images.length)
      await checked(
        client.storage.from("wardrobe-inspiration-images").remove(images),
      );
  }
  // Read schema before exposing the test-only reset endpoint. No migration is applied here.
  await checked(
    client
      .from("wardrobe_inspirations")
      .select("id")
      .eq("owner_id", OWNER)
      .limit(1),
  );
  return { client, reset, close: reset, mode: "supabase-disposable" };
}
module.exports = { OWNER, isolatedConfiguration, createIsolatedSupabase };
