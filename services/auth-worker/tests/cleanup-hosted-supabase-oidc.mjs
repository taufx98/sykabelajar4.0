const token = process.env.OIDC_ACCEPTANCE_TEST_TOKEN;
if (!token || token.length < 32) {
  console.log("No temporary acceptance token was installed; cleanup endpoint was not called.");
  process.exit(0);
}
const response = await fetch("https://auth.sykabelajar.my.id/_internal/oidc-acceptance/cleanup", {
  method: "POST",
  headers: { Authorization: "Bearer " + token },
  redirect: "error",
});
if (!response.ok) {
  throw new Error("Staging synthetic-user cleanup failed with HTTP " + response.status);
}
const payload = await response.json();
if (payload?.ok !== true || !Number.isInteger(payload.removed) || payload.removed < 0 || payload.removed > 2) {
  throw new Error("Staging synthetic-user cleanup returned an unexpected result.");
}
console.log("Staging synthetic identities removed: " + payload.removed);
