# CIOSynthesis

An AI-assisted reader for Georgia Tech Course-Instructor Opinion Survey (CIOS) reports.
Instructors upload their report, get an organized summary, and can ask follow-up
questions about the ratings and student comments — answered via Azure OpenAI, grounded
in the uploaded document.

## Features

- Upload a CIOS report as **PDF, CSV, HTML, XLS/XLSX, or DOC(X)**
- Client-side parsing of every format into plain text before anything is sent to a model
- Automatic summary covering ratings, workload signals, and comment themes (response
  rate/respondent counts are intentionally left out)
- A chat-style Q&A panel backed by retrieval (RAG): the document is chunked and embedded
  once, on the first question asked, then every question searches the full document for
  the most relevant excerpts rather than needing the whole file to fit in one request
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

## Setup (local development)

You need both the frontend dev server and the local Azure Functions host running.

```bash
# 1. Install frontend deps
npm install

# 2. Install the Azure Functions Core Tools (once), if you don't have it
npm install -g azure-functions-core-tools@4 --break-system-packages

# 3. Set your real Azure OpenAI values for local testing
cp api/local.settings.json.example api/local.settings.json
# edit api/local.settings.json:
#   AZURE_OPENAI_ENDPOINT             = https://<your-resource-name>.openai.azure.com
#   AZURE_OPENAI_API_KEY              = <key from the Azure OpenAI resource>
#   AZURE_OPENAI_CHAT_DEPLOYMENT      = <deployment name for your chat model>
#   AZURE_OPENAI_EMBEDDING_DEPLOYMENT = <deployment name for your embedding model>

# 4. In one terminal: start the API
cd api && npm install && func start

# 5. In another terminal: start the frontend (proxies /api to the func host)
npm run dev
```

Then open the printed local URL in your browser. `api/local.settings.json` is
git-ignored, so your credentials never get committed.

## Setting up Azure OpenAI (one-time, before first deploy)

1. In the Azure Portal (or Azure AI Foundry), create an **Azure OpenAI** resource.
   Availability is region-limited, so pick a region that offers the models you want.
2. In Azure AI Foundry, **deploy two models** under that resource:
   - A chat model (e.g. `gpt-4o-mini` or a newer equivalent available to you)
   - An embedding model (e.g. `text-embedding-3-small`)
   Each deployment gets a **deployment name** you choose — it does not have to match
   the underlying model name. You'll use these names as
   `AZURE_OPENAI_CHAT_DEPLOYMENT` / `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`.
3. From the resource's **Keys and Endpoint** page, copy the endpoint URL and a key —
   these become `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY`.

## Deploying to Azure (Static Web Apps)

This repo is set up for **Azure Static Web Apps**, which hosts the built frontend and
the `api/` Azure Functions together, with free HTTPS and CI/CD from GitHub.

1. **Push this project to a GitHub repo.**
2. In the Azure Portal, create a **Static Web App** resource:
   - Deployment source: GitHub → pick your repo/branch
   - Build presets: **Custom**
   - App location: `/`
   - Api location: `api`
   - Output location: `dist`
   - Azure will commit a GitHub Actions workflow to your repo (or reuse the one already
     at `.github/workflows/azure-static-web-apps.yml`) and add an
     `AZURE_STATIC_WEB_APPS_API_TOKEN` secret to the repo automatically.
3. **Set the real Azure OpenAI values in the Static Web App** (not in GitHub, not in the
   repo): resource → **Configuration** → Application settings → add:
   - `AZURE_OPENAI_ENDPOINT`
   - `AZURE_OPENAI_API_KEY`
   - `AZURE_OPENAI_CHAT_DEPLOYMENT`
   - `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`
4. Push to `main` — GitHub Actions builds and deploys automatically. Your app is live at
   `https://<name>.azurestaticapps.net`.
5. Optional: Static Web App → **Custom domains** → add your own domain.

If you created the Static Web App via the Azure CLI instead of the portal (so no token
was added automatically), grab the deployment token from the resource's
**Overview → Manage deployment token**, and add it as a GitHub repo secret named
`AZURE_STATIC_WEB_APPS_API_TOKEN`.

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
- Azure Static Web Apps for hosting + CI/CD

## Project structure

```
api/
  chat/index.js             – Azure Function proxying chat completions to Azure OpenAI
  embeddings/index.js       – Azure Function proxying embeddings to Azure OpenAI
  host.json, package.json   – Azure Functions app config
src/
  App.jsx                   – top-level state machine (upload -> parse -> analyze -> ready)
  App.css                   – GT-themed styling
  components/
    Header.jsx              – GT-branded header
    FileUpload.jsx          – drag-and-drop / click-to-browse uploader
    Pipeline.jsx            – build-log style processing status
    SummaryPanel.jsx        – renders the AI-generated summary
    QAPanel.jsx             – chat interface for follow-up questions
  lib/
    parseDocument.js        – format-aware text extraction
    chunk.js                – splits a parsed document into retrieval chunks
    retrieve.js             – cosine-similarity search over chunk embeddings
    openai.js               – calls to our own /api/chat and /api/embeddings proxies
staticwebapp.config.json    – SPA routing config for Azure Static Web Apps
.github/workflows/          – GitHub Actions CI/CD for Azure Static Web Apps
```
