// Azure Function: POST /api/embeddings
// Proxies embedding requests to Azure OpenAI for the RAG index (chunking +
// retrieval happen in the browser; only the actual model call is server-side).
// Configure these as Application Settings on the Static Web App:
//   AZURE_OPENAI_ENDPOINT                e.g. https://your-resource.openai.azure.com
//   AZURE_OPENAI_API_KEY
//   AZURE_OPENAI_EMBEDDING_DEPLOYMENT    the deployment name for the embedding model

module.exports = async function (context, req) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;

  if (!endpoint || !apiKey || !deployment) {
    context.res = {
      status: 500,
      body: {
        error:
          "Server is missing Azure OpenAI configuration. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_EMBEDDING_DEPLOYMENT in the Static Web App's Environment variables.",
      },
    };
    return;
  }

  const { input } = req.body || {};
  const hasInput = Array.isArray(input) ? input.length > 0 : Boolean(input);

  if (!hasInput) {
    context.res = {
      status: 400,
      body: { error: "Request body must include 'input' (a string or array of strings)." },
    };
    return;
  }

  const userEmail = getUserEmail(req);
  if (!userEmail.toLowerCase().endsWith("@gatech.edu")) {
    context.res = {
      status: 403,
      body: { error: "This tool is restricted to Georgia Tech (@gatech.edu) accounts." },
    };
    return;
  }

  context.log(`[embeddings] request from ${userEmail}`);

  try {
    const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/embeddings?api-version=2024-10-21`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({ input }),
    });

    const data = await response.json();

    if (!response.ok) {
      context.res = {
        status: response.status,
        body: { error: data?.error?.message || "Azure OpenAI embeddings request failed." },
      };
      return;
    }

    const ordered = [...data.data].sort((a, b) => a.index - b.index);
    context.res = {
      status: 200,
      body: { embeddings: ordered.map((d) => d.embedding) },
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
