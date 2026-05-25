# Dub2 Ebook MVP

Dub2 Ebook is a local-first ebook dubbing MVP. It combines a Vue workspace for book, voice, and chapter operations with an Express API that parses ebooks, stores chapter/dialogue state in SQLite, and generates or exports TTS audio.

## Project Structure

```text
.
├── ebook-api/   # Express API, SQLite repositories, parsing, AI/TTS services
└── ebook-ui/    # Vue 3 + Vite frontend
```

## Features

- Import and manage ebook metadata and chapters.
- Analyze chapter content into characters, dialogue, annotations, and segments.
- Bind book characters to system, provider, or cloned voices.
- Generate dialogue audio and track background jobs.
- Preview chapter dubbing and export chapter audio.
- Manage provider voices through the TTS/Mosi integrations.

## Requirements

- Node.js 20+
- npm
- Mosi API credentials for provider TTS features
- DeepSeek-compatible API credentials for AI analysis features

## Environment

Create the API environment file from the example:

```bash
cd ebook-api
cp .env.example .env
```

Then fill in the credentials:

```dotenv
PORT=13000
DB_PATH=database.sqlite
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_API_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_TIMEOUT=60000
MOSI_API_KEY=your_mosi_api_key_here
MOSI_BASE_URL=https://studio.mosi.cn
```

## Run Locally

Install and start the API:

```bash
cd ebook-api
npm install
npm start
```

In another terminal, install and start the UI:

```bash
cd ebook-ui
npm install
npm run dev
```

The default local URLs are:

- API: `http://localhost:13000`
- UI: `http://localhost:13001`

The Vite dev server proxies `/api`, `/audio`, and `/covers` to the API server.

## Build

```bash
cd ebook-ui
npm run build
```

## Local Data

Runtime data is intentionally not committed:

- SQLite database files: `database.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`
- Generated audio and exports under `ebook-api/public/`
- Uploaded files and local logs
- API secrets in `.env`

Keep `.env.example` updated when adding new configuration keys.

## API Notes

Main API groups:

- `/api/books`
- `/api/chapters`
- `/api/chapter-characters`
- `/api/dialogues`
- `/api/annotations`
- `/api/tts`
- `/api/mosi`
- `/api/jobs`

See `ebook-api/docs/api.md` for the more detailed endpoint notes.
