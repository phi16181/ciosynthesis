// Azure Function: POST /api/chat
// Proxies chat completion requests to Azure OpenAI, keeping the API key
// server-side. Configure these as Application Settings on the Static Web App
// (never in the frontend):
//   AZURE_OPENAI_ENDPOINT            e.g. https://your-resource.openai.azure.com
//   AZURE_OPENAI_API_KEY
//   AZURE_OPENAI_CHAT_DEPLOYMENT     the deployment name you gave the chat model
//                                    in Azure AI Foundry (not the base model name)

module.exports = async function (context, req) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT;

  if (!endpoint || !apiKey || !deployment) {
      const missing = [];
      if (!endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
      if (!apiKey) missing.push("AZURE_OPENAI_API_KEY");
      if (!deployment) missing.push("AZURE_OPENAI_CHAT_DEPLOYMENT");
      context.res = {
        status: 500,
        body: {
          error: `Server is missing these Azure OpenAI settings: ${missing.join(", ")}. Set them in the Function App's Environment variables.`,
        },
      };
      return;
    }

  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    context.res = {
      status: 400,
      body: { error: "Request body must include a non-empty 'messages' array." },
    };
    return;
  }

  // staticwebapp.config.json only requires the built-in "authenticated" role
  // (any Microsoft account) — the @gatech.edu restriction is enforced here,
  // matching the same check done client-side, so it can't be bypassed by
  // calling this endpoint directly.
  const userEmail = getUserEmail(req);
  if (!userEmail.toLowerCase().endsWith("@gatech.edu")) {
    context.res = {
      status: 403,
      body: { error: "This tool is restricted to Georgia Tech (@gatech.edu) accounts." },
    };
    return;
  }

  // Basic usage trail: who asked for what, visible in the Function's logs /
  // Application Insights if connected.
  context.log(`[chat] request from ${userEmail}`);

  try {
    const url = `${endpoint.replace(/\/$/, "")}/openai/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        model: deployment,
        temperature: 0.3,
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      context.res = {
        status: response.status,
        body: { error: data?.error?.message || "Azure OpenAI request failed." },
      };
      return;
    }

    context.res = {
      status: 200,
      body: { content: data.choices?.[0]?.message?.content?.trim() ?? "" },
    };
  } catch (err) {
    context.res = {
      status: 500,
      body: { error: err.message || "Unexpected server error while contacting Azure OpenAI." },
    };
  }
};

function getUserEmail(req) {
  try {
    const header = req.headers["x-ms-client-principal"];
    if (!header) return "unknown";
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
    return decoded.userDetails || "unknown";
  } catch {
    return "unknown";
  }
}
