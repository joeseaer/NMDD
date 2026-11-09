const test = require("node:test");
const assert = require("node:assert/strict");
const { isolatedConfiguration } = require("./helpers/isolatedSupabase");
test("cloud acceptance requires explicit disposable credentials and always refuses the known production project", () => {
  assert.equal(isolatedConfiguration({}), null);
  const flags = {
    NMDD_E2E_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    NMDD_E2E_PROJECT_REF: "abcdefghijklmnopqrst",
    NMDD_E2E_SERVICE_ROLE_KEY: "fake-key",
    NMDD_E2E_CONFIRM_DISPOSABLE_PROJECT: "yes",
  };
  assert.ok(isolatedConfiguration(flags));
  assert.throws(
    () =>
      isolatedConfiguration({
        ...flags,
        NMDD_E2E_CONFIRM_DISPOSABLE_PROJECT: "",
      }),
    /disposable/,
  );
  assert.throws(
    () =>
      isolatedConfiguration({
        ...flags,
        NMDD_E2E_PROJECT_REF: "vhbyauefgjhlfjbikdek",
        NMDD_E2E_SUPABASE_URL: "https://vhbyauefgjhlfjbikdek.supabase.co",
      }),
    /prohibited/,
  );
  assert.throws(
    () =>
      isolatedConfiguration({
        ...flags,
        NMDD_E2E_SUPABASE_URL:
          "https://abcdefghijklmnopqrst.supabase.co.attacker.invalid",
      }),
    /disposable/,
  );
});
