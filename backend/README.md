# Harikatha AI — backend

Local-first FastAPI backend. No hosted API key is required when using Ollama and a local Piper voice.

## 1. Install Ollama and a model

Install Ollama from https://ollama.com/ and then run:

```bash
ollama pull qwen2.5:3b
ollama list
```

Keep Ollama running while using the app. On lower-memory laptops, a smaller model may be needed; generation speed depends on your hardware.

## 2. Install the backend

Windows Command Prompt:

```bat
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

Linux/macOS:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs
Health check: http://localhost:8000/api/v1/health

## 3. Optional local TTS with Piper

Install Piper TTS in the same virtual environment if supported for your platform:

```bash
pip install piper-tts
```

Download a Piper voice model (`.onnx`) and its matching `.onnx.json` configuration from the official Piper voice resources/repository. Review the voice model's license before use. Set `PIPER_MODEL_PATH` in `backend/.env` to the full path to the `.onnx` file. Ensure the `piper` command is available on PATH. Voice availability and language quality vary; verify that the chosen voice supports the language you select.

Audio generation endpoint: `POST /api/v1/harikatha/{performance_id}/audio/{section_index}`. It returns an audio URL that can be played in a browser.

## Source reliability warning

The included source corpus contains only an explicitly labelled original demo reflection. It is not scripture. Add only texts you have obtained from trustworthy, appropriately licensed sources. Review and update each source's `status` and citation before treating it as verified. Retrieval alone does not establish authenticity. The application instructs the LLM not to invent sacred quotations, but generated content still needs human review.
