# AnalytiCore: Llama 3 Agentic AI Note Application

A modern, high-performance note application built with **React**, **TypeScript**, and **Vite**. The application connects to local **Llama 3 via Ollama** using the Ollama JavaScript SDK.

## Core Features
1. **Left Navigation Sidebar**:
   - **Dashboard & Analytics**: Live uploaded-file metrics, store visits by weekday, spend progression, best-selling items, K-means clustering, and linear regression forecasts for structured uploaded data and cross-file product price history.
   - **Data Ingestion**: Upload PDF, CSV, and TXT files up to 50MB. Extracted text is searchable by the assistant while the app is open.
   - **API & Model Setup**: Configuration for an Ollama-compatible endpoint and model, temperature, and context window.
2. **Interactive Llama 3 Agent Chatbox**:
   - Floating chat widget available across all views.
   - Searches uploaded document text locally before each answer and supplies at most five matching chunks plus summaries from up to three relevant tables to Ollama.
   - For detected tables, computes full-dataset row counts, numeric sums/averages/medians/population standard deviations/ranges/missing counts, common category values, and representative rows locally to support file analysis.
   - Uses relevant historical excerpts, or representative excerpts from the imported files if exact keyword matches are absent.
   - Provides concise, evidence-based financial, data, and actuarial-risk analysis, prioritizing practical recommendations to improve sustainable profit and reduce avoidable costs.
   - Treats imported monetary values as South African rand (ZAR), displays them with `R`, and asks a focused clarifying question when missing information could change its advice.
   - Uses locally calculated machine-learning regression forecasts when relevant; explains assumptions, risk, and forecast limitations and expands only when asked.
   - Sends questions and retrieved file excerpts and calculated analysis to the configured model endpoint.
   - Does not expose database, shell, or other executable tools to the model.

Uploaded original files, extracted text, and metadata are stored in the local MySQL database and restored when the app restarts. Text chunks are stored separately and cascade-delete with their source document. The Data Ingestion page can download original files from MySQL or delete an upload and its stored data. PDF support extracts selectable text; scanned PDFs need OCR and are not supported. Retrieval uses local keyword matching rather than vector embeddings. Structured CSV and detected PDF/TXT tables are analyzed across all rows; the model receives locally calculated aggregates from up to three relevant tables, while narrative files are provided through retrieved text excerpts. Earlier assistant responses are not resent as evidence on new questions; explicit explanation follow-ups include the previous answer marked as unverified. Existing browser IndexedDB uploads are migrated to MySQL on startup.

## Security boundaries

There is no browser Content Security Policy restricting network connections. The agent sends the conversation, retrieved file excerpts, and calculated analysis to the endpoint configured in API & Model Setup. A system prompt directs it to ground recommendations in supplied data, keep initial answers concise, use South African rand for monetary figures, ask focused clarifying questions when material information is missing, distinguish estimates from source facts, and treat imported content as untrusted; this is guidance, not a guarantee of model behavior or a model-weight fine-tune. Pointing this setting at a remote endpoint sends that information to the service. The Ollama chat integration does not itself provide a web-search tool.

The API and MySQL port bind to loopback and are intended for a single local user; there is no login or tenant isolation. The API retains file-type and file-size checks, metadata validation, and parameterized SQL queries for database integrity. Document parsing and keyword retrieval run locally, but this app does not use LlamaIndex.TS or generate vector embeddings. OCR is not supported.

The analytics dashboard checks every ready PDF, CSV, and TXT upload for structured, delimited table data. Retail charts combine compatible records across uploaded files and infer date, spend, item, quantity, and customer columns from detected headers; columns can be adjusted manually. Weekday visits count rows by default, or distinct customer/date pairs when a customer column is selected. Spend can be grouped by day, week, or month and includes a cumulative total. Popular items rank by quantity when available, otherwise by transaction rows. Narrative documents without a structured table remain available to the assistant but cannot provide transaction-chart values. For relevant forecast questions, the assistant also receives locally calculated product-price predictions and numeric-column trend projections, where the available rows support regression.

K-means classification and general linear regression run on the individually selected structured dataset. Regression lets you choose a numeric target and either row order or another numeric field as the input. The product price forecast separately combines dated product-price rows from all ready uploaded files, averages repeated product prices per day, and fits a linear trend for the selected product. It uses an explicit unit-price column when present; otherwise, it derives unit price from line totals and positive quantities. It requires at least three distinct dated observations and forecasts three steps using the median historical date interval. Invoice line prices are also derived by dividing line totals by quantities. Forecasts extrapolate a straight-line trend and should be treated as estimates, not guarantees; R² describes fit to historical observations and is not a forecast confidence score. PDF text extraction preserves layout for table detection and refreshes saved PDFs with the current extractor on app startup.

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
