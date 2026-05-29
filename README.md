# dub

dub is an ebook dubbing workspace. It combines a Vue workspace with an Express API that stores metadata in PostgreSQL, stores media in S3-compatible object storage, parses ebooks, analyzes chapters, generates TTS audio, and exports chapter audio.

## Project Structure

```text
.
├── ebook-api/   # Express API, PostgreSQL repositories, S3 storage, parsing, AI/TTS services
└── ebook-ui/    # Vue 3 + Vite frontend
```

## Requirements

- Node.js 20+
- npm
- PostgreSQL 16+
- S3-compatible storage such as MinIO, AWS S3, R2, or OSS
- Mosi/Fish/DeepSeek credentials for provider features

## Environment

```bash
cd ebook-api
cp .env.example .env
```

Important settings:

```dotenv
PORT=13000
DATABASE_URL=postgres://ebook:ebook@localhost:5432/ebook
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=ebook
S3_ACCESS_KEY_ID=ebook
S3_SECRET_ACCESS_KEY=ebook-secret
S3_FORCE_PATH_STYLE=true
```

## Run With Docker

```bash
docker compose up --build
```

Default URLs:

- UI: `http://localhost:13001`
- API: `http://localhost:13000`
- MinIO Console: `http://localhost:9001`

Health check:

```bash
curl http://localhost:13000/api/health
```

## Run Locally

Start PostgreSQL and S3-compatible storage first, then:

```bash
cd ebook-api
npm install
npm run schema:init
npm start
```

In another terminal:

```bash
cd ebook-ui
npm install
npm run dev
```

The Vite dev server proxies `/api` and `/media` to the API server.

## Backup And Restore

Create a self-contained backup:

```bash
cd ebook-api
npm run backup -- ./backups/backup-name
```

Restore into a fresh deployment:

```bash
cd ebook-api
npm run restore -- ./backups/backup-name
npm run doctor
```

The backup contains a PostgreSQL custom dump, mirrored S3 objects, and manifests. The restore path is database first, objects second, doctor verification last.

## Data Model

- PostgreSQL stores books, chapters, dialogues, jobs, voice assets, bindings, export records, and `storage_objects`.
- S3 stores all binary business data: source ebooks, covers, voice samples, generated dialogue audio, and chapter exports.
- Media URLs are private API proxy paths shaped as `/media/{encoded-object-key}`.
