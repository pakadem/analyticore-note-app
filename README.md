# AnalytiCore: Llama 3 Agentic AI Note Application

A modern, high-performance note application built with **React**, **TypeScript**, and **Vite**. The application connects to local **Llama 3 via Ollama** using the Ollama JavaScript SDK.

## Core Features
1. **Left Navigation Sidebar**:
   - **Dashboard & Analytics**: Live uploaded-file metrics, store visits by weekday, spend progression, best-selling items, K-means clustering, and linear regression forecasts for structured uploaded data.
   - **Data Ingestion**: Upload PDF, CSV, and TXT files up to 50MB. Extracted text is searchable by the assistant while the app is open.
   - **API & Model Setup**: Configuration for a local Ollama model (`llama3:8b`, temperature, context window). The endpoint is fixed to `http://127.0.0.1:11434`.
2. **Interactive Llama 3 Agent Chatbox**:
   - Floating chat widget available across all views.
   - Searches uploaded document text locally before each answer and supplies at most five matching chunks to Ollama.
   - For detected tables, computes full-dataset row counts, numeric sums/averages/ranges/missing counts, common category values, and representative rows locally to support file analysis.
   - Uses relevant historical excerpts, or representative excerpts from the imported files if exact keyword matches are absent.
   - Answers questions across topics using imported file evidence; requests to search the internet are declined.
   - Does not expose database, shell, or other executable tools to the model.

Uploaded original files, extracted text, and metadata are stored in the local MySQL database and restored when the app restarts. Text chunks are stored separately and cascade-delete with their source document. The Data Ingestion page can download original files from MySQL. PDF support extracts selectable text; scanned PDFs need OCR and are not supported. Retrieval uses local keyword matching rather than vector embeddings. Structured CSV and detected PDF/TXT tables are analyzed across all rows; the model receives locally calculated aggregates plus representative rows, while narrative files are provided through retrieved text excerpts. Existing browser IndexedDB uploads are migrated to MySQL on startup.

## Security boundaries

The browser Content Security Policy blocks remote connections and permits the local Ollama endpoint, plus loopback WebSocket connections for Vite development. Development mode permits inline scripts for React Refresh; the production build removes that allowance. The assistant validates the Ollama URL, strips control characters from messages, rejects common prompt-override and command patterns, treats retrieved file text as untrusted evidence, and performs retrieval in application code with one bounded model call. The assistant answers across topics from imported historical files; it declines requests to search the internet and identifies when uploaded records do not contain enough evidence.

The API and MySQL port bind to loopback and are intended for a single local user; there is no login or tenant isolation. Browser policy is not a substitute for runtime/container egress firewall rules. Document parsing and keyword retrieval run locally, but this app does not use LlamaIndex.TS or generate vector embeddings. It does not execute critical operations, and OCR is not supported; therefore database-operation authorization and low-confidence OCR confirmation are not implemented. Those guarantees require corresponding infrastructure.

The analytics dashboard checks every ready PDF, CSV, and TXT upload for structured, delimited table data. Retail charts combine compatible records across uploaded files and infer date, spend, item, quantity, and customer columns from detected headers; columns can be adjusted manually. Weekday visits count rows by default, or distinct customer/date pairs when a customer column is selected. Spend can be grouped by day, week, or month and includes a cumulative total. Popular items rank by quantity when available, otherwise by transaction rows. Narrative documents without a structured table remain available to the assistant but cannot provide transaction-chart values.

K-means classification and linear regression run on the individually selected structured dataset. Regression lets you choose a numeric target and either row order or another numeric field as the input. At least three valid observations are needed. Forecasts extrapolate a linear trend and should be treated as estimates, not guarantees. PDF text extraction preserves layout for table detection and refreshes saved PDFs with the current extractor on app startup.

## Quick Start Guide

### Prerequisites
1. **Node.js**: v18.0+ or Node 20+
2. **Modern browser**: ES2022 module support is required for PDF text extraction.
3. **Colima with Docker Compose**: Start Colima before running MySQL.
4. **Ollama Service**:
   ```bash
   # Download and start local Llama 3 model
   ollama pull llama3:8b
   ollama serve
   ```

### Application Installation
```bash
# Install dependencies
npm install

# Create local database credentials (keep .env private)
cp .env.example .env
# Replace both placeholder passwords in .env with strong, unique local passwords.

# Start the MySQL database
npm run db:up

# Start the local API and Vite development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The API creates the `documents` and `document_chunks` tables automatically on startup. To run the production server, first run `npm run build`, then `npm start`; the API serves the built application and database endpoints on port 3002.
