# Harikatha AI — local-first open-source starter

A starter application for generating structured Harikatha-inspired performances and optionally narrating sections with local text-to-speech. It uses FastAPI, React, Ollama, ChromaDB/Sentence Transformers retrieval, and optional Piper TTS.

## What is included

- React + Vite UI for story input and performance reading.
- FastAPI backend with generation, history, source, and audio endpoints.
- Ollama integration (no hosted LLM API key).
- Local source retrieval using ChromaDB + Sentence Transformers when dependencies/models are available; keyword fallback otherwise.
- Optional Piper audio generation.
- Saved performances in a local JSON file.
- A source corpus containing only an explicitly labelled original demo reflection.

## Requirements

- Python 3.11 recommended.
- Node.js 20+ recommended.
- Ollama installed and running.
- Enough RAM for the selected local model. Model downloads can be several GB.
- Optional Piper TTS installation and a compatible downloaded voice model.

## Start the backend

Windows Command Prompt:

```bat
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
ollama pull qwen2.5:3b
uvicorn app.main:app --reload --port 8000
```

If Ollama is installed separately, start the Ollama application first. You can run `ollama list` to check installed models.

## Start the frontend

Open a second terminal:

```bat
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. API documentation is at http://localhost:8000/docs.

## Optional audio setup

See `backend/README.md` for Piper instructions. Audio is disabled until a compatible voice model is downloaded and `PIPER_MODEL_PATH` is configured in `backend/.env`.

## Important limitations

- This is a starter MVP, not a claim of fully authenticated traditional scholarship.
- The bundled source corpus is a demo only, not a scriptural corpus. Add reliable, appropriately licensed source material before using it for devotional or scholarly content.
- Retrieval does not prove authenticity. Human review is still necessary for Sanskrit verses, songs, translations, and raga/tala metadata.
- Although the UI offers several language choices, quality depends on the installed LLM and selected TTS voice. Confirm that your local model and voice actually support the language before relying on them.
- The UI uses Google Fonts if internet is available; the app can still function without them using fallback fonts.
- The starter has no user authentication. Run it locally and do not expose it publicly without adding authentication, rate limiting, and appropriate storage/security controls.
