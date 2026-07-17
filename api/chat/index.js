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
    context.res = {
      status: 500,
      jsonBody: {
        error:
          "Server is missing Azure OpenAI configuration. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_CHAT_DEPLOYMENT in the Static Web App's Configuration.",
      },
    };
    return;
  }

  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    context.res = {
      status: 400,
      jsonBody: { error: "Request body must include a non-empty 'messages' array." },
    };
    return;
  }

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
        jsonBody: { error: data?.error?.message || "Azure OpenAI request failed." },
      };
      return;
    }

    context.res = {
      status: 200,
      jsonBody: { content: data.choices?.[0]?.message?.content?.trim() ?? "" },
    };
  } catch (err) {
    context.res = {
      status: 500,
      jsonBody: { error: err.message || "Unexpected server error while contacting Azure OpenAI." },
    };
  }
};
