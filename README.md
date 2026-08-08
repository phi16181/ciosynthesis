# CIOSynthesis azure

An AI-assisted reader for Georgia Tech Course-Instructor Opinion Survey (CIOS) reports.
Instructors upload their report, get an organized summary, and can ask follow-up
questions about the ratings and student comments — answered via Azure OpenAI, grounded
in the uploaded document. Access is restricted to Georgia Tech (@gatech.edu) Microsoft
accounts.

## Features

- Upload a CIOS report as **PDF, CSV, HTML, XLS/XLSX, or DOC(X)**
- Client-side parsing of every format into plain text before anything is sent to a model
- Automatic summary covering ratings, workload signals, and comment themes (response
  rate/respondent counts are intentionally left out)
- A chat-style Q&A panel backed by retrieval (RAG): the document is chunked and embedded
  once, on the first question asked, then every question searches the full document for
  the most relevant excerpts rather than needing the whole file to fit in one request
- Sign-in required for every page and every API call, restricted to Georgia Tech
  Microsoft accounts — see "Authentication" below
- Georgia Tech–themed UI (navy/gold), with a build-log style status indicator while
  a report is parsed and summarized

## Architecture: where your Azure OpenAI credentials live

The frontend never talks to Azure OpenAI directly, and never sees your endpoint, key, or
deployment names. It calls two of its own endpoints instead:

- `/api/chat` — an Azure Function (`api/chat/index.js`) that proxies chat completions
- `/api/embeddings` — an Azure Function (`api/embeddings/index.js`) that proxies
  embedding requests (used to build/query the RAG index)

Both functions read `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and the relevant
deployment name from server-side environment/application settings. This is what makes it
safe to deploy this app publicly.

**These functions run as a standalone Azure Function App**, not as Static Web Apps'
built-in "managed functions." We hit a known platform inconsistency with managed
functions (a clean, successful deploy log, followed by every `/api/*` route 404ing at
runtime — see [Azure/static-web-apps#1681](https://github.com/Azure/static-web-apps/issues/1681)),
so this app uses the "Bring your own Functions" pattern instead: a separate Function App
resource, deployed by its own GitHub Actions workflow, linked to the Static Web App so it's
still reachable at the same `/api/*` paths from the frontend. See "Deploying the API"
below for the one-time setup.

## Authentication

The whole app — every page and every `/api/*` call — requires signing in with a
Microsoft account, enforced by `staticwebapp.config.json` (Azure Static Web Apps' built-in
authentication). There's no custom login form and no password storage of any kind on our
side.

`staticwebapp.config.json` itself only requires the platform's built-in `"authenticated"`
role — deliberately not a custom role. An earlier version of this used a custom
`"gatech"` role assigned via a `rolesSource` function, but that combination triggered a
known Azure Static Web Apps issue where the built-in login route itself starts returning
404 instead of redirecting to Microsoft. Sticking to the plain `"authenticated"` role
avoids that entirely.

The actual **"must be a Georgia Tech account"** restriction happens in two places instead:

- **Client-side** (`App.jsx`): on load, the app calls the built-in `/.auth/me` endpoint,
  checks whether the signed-in account's email ends in `@gatech.edu`, and shows a
  plain "not authorized" screen with a sign-out link if it doesn't.
- **Server-side** (`api/chat/index.js`, `api/embeddings/index.js`): each function
  independently decodes the `x-ms-client-principal` header Static Web Apps attaches to
  every authenticated request and rejects (403) anything that isn't `@gatech.edu` — so
  the restriction holds even if someone bypasses the frontend and calls the API directly.

Someone with any other Microsoft account can still complete sign-in (Static Web Apps'
default provider allows any Microsoft account), but is blocked immediately afterward by
both of the checks above.

Each accepted request into `/api/chat` and `/api/embeddings` also logs the signed-in
user's email via `context.log(...)`, visible in the Function's logs (or Application
Insights, if you connect it to the Static Web App) — a basic usage trail without needing
a database.

**Note:** this doesn't require registering anything with Georgia Tech's IT/Entra tenant —
the restriction is enforced in our own code after a normal Microsoft sign-in, not through
a tenant-specific app registration. That keeps setup simple, though it does mean the
sign-in screen itself doesn't visually say "Georgia Tech" — someone would only find out
they're blocked after trying to log in with a non-GT account.

## Setup (local development)

You need both the frontend dev server and the local Azure Functions host running.
Note: Static Web Apps' built-in authentication (`/.auth/...`) doesn't work with a plain
`func start` + `vite dev` setup — it requires the
[Static Web Apps CLI](https://learn.microsoft.com/en-us/azure/static-web-apps/local-development)
(`swa start`), which emulates login locally with a mock sign-in screen.

```bash
# 1. Install frontend deps
npm install

# 2. Install the Azure Functions Core Tools and the Static Web Apps CLI (once)
npm install -g azure-functions-core-tools@4 --break-system-packages
npm install -g @azure/static-web-apps-cli --break-system-packages

# 3. Set your real Azure OpenAI values for local testing
cp api/local.settings.json.example api/local.settings.json
# edit api/local.settings.json:
#   AZURE_OPENAI_ENDPOINT             = https://<your-resource-name>.openai.azure.com
#   AZURE_OPENAI_API_KEY              = <key from the Azure OpenAI resource>
#   AZURE_OPENAI_CHAT_DEPLOYMENT      = <deployment name for your chat model>
#   AZURE_OPENAI_EMBEDDING_DEPLOYMENT = <deployment name for your embedding model>

# 4. Build the frontend once (swa start serves the built output, not the raw dev server,
#    when API + auth are both involved) — or run `npm run dev` in a separate terminal
#    and point swa start at it instead; see the SWA CLI docs for both modes.
npm run build

# 5. Start everything through the SWA CLI emulator
swa start dist --api-location api
```

`swa start` prints a local URL (typically `http://localhost:4280`) that emulates the
`/.auth/*` routes with a mock login screen — enter a fake identity with a `@gatech.edu`
userDetails value to see the app; anything else should land on the "not authorized"
screen. `api/local.settings.json` is git-ignored, so your Azure OpenAI credentials never
get committed.

## Setting up Azure OpenAI (one-time, before first deploy)

1. In the Azure Portal (or Microsoft Foundry), create an **Azure OpenAI** resource.
   Availability is region-limited, so pick a region that offers the models you want.
2. In the Foundry portal, go to **Models + Endpoints** and **deploy two models**:
   - A chat model (e.g. `gpt-4o-mini` or a newer equivalent available to you)
   - An embedding model (e.g. `text-embedding-3-small`)
   Each deployment gets a **deployment name** you choose — it does not have to match
   the underlying model name. You'll use these names as
   `AZURE_OPENAI_CHAT_DEPLOYMENT` / `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`.
3. From the resource's **Keys and Endpoint** page, copy the endpoint URL and a key —
   these become `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY`.

## Deploying the API (standalone Azure Function App)

This is a one-time setup per environment. Do this **before** relying on the frontend
deploy, since the frontend's `/api/*` calls won't work until it's linked.

1. **Create a Function App resource** in the Azure Portal: Create a resource → search
   "Function App" → Create.
   - Hosting: **Consumption** plan is fine for this workload.
   - Runtime stack: **Node.js**, version 20 or 22 (match `NODE_VERSION` in
     `.github/workflows/deploy-functions.yml`).
   - OS: Linux.
   - Region: any region — this path isn't restricted to the small region list that
     Static Web Apps' managed Functions require.
   - Note the **Function App name** you choose.
2. **Set the Azure OpenAI values on this Function App** (not on the Static Web App):
   resource → **Environment variables** (or **Configuration** → Application settings,
   depending on portal version) → add:
   - `AZURE_OPENAI_ENDPOINT`
   - `AZURE_OPENAI_API_KEY`
   - `AZURE_OPENAI_CHAT_DEPLOYMENT`
   - `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`
3. **Get a publish profile**: Function App resource → **Overview** → **Get publish
   profile** (downloads an XML file). Copy its entire contents.
4. **Add it as a GitHub secret**: repo → Settings → Secrets and variables → Actions →
   New repository secret → name it `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`, paste the XML.
5. **Set the Function App name in the workflow**: edit
   `.github/workflows/deploy-functions.yml`, change
   `AZURE_FUNCTIONAPP_NAME: your-function-app-name` to the name from step 1.
6. **Push to `main`** (or run the workflow manually from the Actions tab) — this deploys
   `chat` and `embeddings` to the standalone Function App. Confirm both show up under
   the Function App resource's **Functions** blade before moving on.
7. **Link it to the Static Web App**: open your Static Web App resource → **Settings** →
   **APIs** → on the Production row, select **Link** → choose the Function App you just
   created → **Link**. This makes it reachable at the same `/api/*` paths the frontend
   already calls — no frontend code changes needed.

Once linked, this Function App is the one serving `/api/chat` and `/api/embeddings` —
Static Web Apps' own managed-Functions feature is no longer used at all.

## Deploying the frontend (Static Web Apps)

If you already have the Static Web App resource from earlier setup, you don't need to
recreate it — just make sure its workflow's `api_location` is set to `""` (already done
in `.github/workflows/azure-static-web-apps.yml`) and that step 7 above has been done.

For a fresh setup:

1. **Push this project to a GitHub repo.**
2. In the Azure Portal, create a **Static Web App** resource:
   - Deployment source: GitHub → pick your repo/branch
   - Build presets: **Custom**
   - App location: `/`
   - Api location: *(leave blank — the API is deployed separately, see above)*
   - Output location: `dist`
   - Azure will auto-generate its own GitHub Actions workflow and an
     `AZURE_STATIC_WEB_APPS_API_TOKEN` repo secret. If this leaves two workflow files
     for the frontend in `.github/workflows/`, keep whichever one Azure generated and
     delete the other — just make sure its `api_location` is empty.
3. Push to `main` — GitHub Actions builds and deploys automatically. Your app is live at
   `https://<name>.azurestaticapps.net`, and signing in is required immediately.
4. Optional: Static Web App → **Custom domains** → add your own domain.

## File format notes

- **PDF, CSV, HTML, XLSX/XLS, DOCX** are fully supported and parsed in-browser.
- **Legacy `.doc`** (the pre-2007 binary Word format) can't be reliably parsed in
  the browser. If you have a `.doc` file, re-save it as `.docx` in Word first.
- The upfront summary is based on a bounded sample for very large files (the UI flags
  this when it happens), but Q&A always searches the complete document regardless of
  size, since it retrieves only the relevant excerpts per question rather than needing
  everything to fit in context at once.

## Tech stack

- React + Vite
- `pdfjs-dist` for PDF text extraction
- `papaparse` for CSV
- `xlsx` (SheetJS) for Excel workbooks
- `mammoth` for DOCX
- Azure OpenAI (chat completions + embeddings), called through two Azure Functions
- Azure Static Web Apps for hosting, built-in authentication, and CI/CD

## Project structure

```
api/
  chat/index.js             – Azure Function proxying chat completions to Azure OpenAI,
                               rejects non-@gatech.edu accounts (403)
  embeddings/index.js       – same, for embeddings
  host.json, package.json   – Azure Functions app config
  (deployed as a standalone Function App — see "Deploying the API" — not as Static
  Web Apps' managed Functions)
src/
  App.jsx                   – top-level state machine (upload -> parse -> analyze -> ready)
  App.css                   – GT-themed styling
  components/
    Header.jsx              – GT-branded header, shows signed-in user + sign-out link
    FileUpload.jsx          – drag-and-drop / click-to-browse uploader
    Pipeline.jsx            – build-log style processing status
    SummaryPanel.jsx        – renders the AI-generated summary
    QAPanel.jsx             – chat interface for follow-up questions
  lib/
    parseDocument.js        – format-aware text extraction
    chunk.js                – splits a parsed document into retrieval chunks
    retrieve.js             – cosine-similarity search over chunk embeddings
    openai.js                – calls to our own /api/chat and /api/embeddings proxies
staticwebapp.config.json    – SPA routing and auth requirements (built-in "authenticated" role)
.github/workflows/
  azure-static-web-apps.yml – builds/deploys the frontend to Static Web Apps
  deploy-functions.yml      – builds/deploys api/ to the standalone Function App
```
