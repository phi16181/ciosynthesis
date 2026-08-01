// Azure Function: POST /api/GetRoles
// Static Web Apps calls this automatically, once, right after a user signs in
// with Microsoft — it's referenced as "rolesSource" in staticwebapp.config.json.
// Its only job is to decide which custom roles (beyond the built-in
// "anonymous"/"authenticated") a signed-in user gets. staticwebapp.config.json's
// route rules are what actually gate access — this function just decides who
// qualifies for the "gatech" role that those rules require.
//
// The default Microsoft login provider accepts ANY Microsoft account (work,
// school, or personal) — it does not restrict by organization on its own.
// Restricting to Georgia Tech is done here instead: only an @gatech.edu
// email/UPN gets the "gatech" role. Everyone else can still complete
// Microsoft sign-in, but without this role they're blocked by
// staticwebapp.config.json and shown the unauthorized page.
//
// Once this function is wired up as rolesSource, Azure Static Web Apps
// prevents it from being called by any external request — only the platform
// itself can invoke it during login.

module.exports = async function (context, req) {
  const body = req.body || {};
  const userDetails = (body.userDetails || "").toLowerCase();
  const claims = Array.isArray(body.claims) ? body.claims : [];

  const emailClaim = claims.find(
    (c) =>
      c.typ === "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress" ||
      c.typ === "preferred_username" ||
      c.typ === "upn"
  );
  const email = (emailClaim?.val || userDetails || "").toLowerCase();

  const roles = [];
  if (email.endsWith("@gatech.edu")) {
    roles.push("gatech");
  }

  context.res = {
    status: 200,
    jsonBody: { roles },
  };
};
