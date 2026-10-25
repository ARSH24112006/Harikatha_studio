from __future__ import annotations

import json

import os

import re

import shutil

import subprocess

import uuid

from datetime import datetime, timezone

from pathlib import Path

from typing import Any

import httpx

from fastapi import FastAPI, HTTPException

from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import FileResponse

from pydantic import BaseModel, Field

from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):

    ollama_base_url: str = "http://localhost:11434"

    ollama_model: str = "qwen2.5:3b"

    piper_model_path: str = ""

    piper_executable: str = "piper"

    data_dir: str = "./data"

    chroma_dir: str = "./data/chroma"

    frontend_origin: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()

ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = (ROOT / settings.data_dir).resolve() if not Path(settings.data_dir).is_absolute() else Path(settings.data_dir)

AUDIO_DIR = DATA_DIR / "audio"

PERFORMANCE_FILE = DATA_DIR / "performances.json"

CORPUS_FILE = ROOT / "data" / "sources.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)

AUDIO_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Harikatha AI", version="0.1.0", description="Local-first Harikatha storytelling and narration prototype")

app.add_middleware(

    CORSMiddleware,

    allow_origins=[settings.frontend_origin, "http://127.0.0.1:5173"],

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],

)

class GenerateRequest(BaseModel):

    story: str = Field(min_length=20, max_length=20000)

    title: str = Field(default="My Harikatha", max_length=160)

    language: str = Field(default="English", max_length=60)

    duration_minutes: int = Field(default=8, ge=3, le=45)

    tone: str = Field(default="devotional and engaging", max_length=100)

    audience: str = Field(default="general audience", max_length=100)

class SourceRecord(BaseModel):

    id: str

    title: str

    source_type: str

    text: str

    citation: str

    status: str = "needs_review"

def load_performances() -> dict[str, Any]:

    if not PERFORMANCE_FILE.exists():

        return {}

    try:

        return json.loads(PERFORMANCE_FILE.read_text(encoding="utf-8"))

    except (json.JSONDecodeError, OSError):

        return {}

def save_performances(items: dict[str, Any]) -> None:

    PERFORMANCE_FILE.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")

def load_sources() -> list[dict[str, Any]]:

    if not CORPUS_FILE.exists():

        return []

    try:

        data = json.loads(CORPUS_FILE.read_text(encoding="utf-8"))

        return data if isinstance(data, list) else []

    except (json.JSONDecodeError, OSError):

        return []

def retrieve_sources(query: str, limit: int = 4) -> list[dict[str, Any]]:

    """Best-effort local retrieval. Uses Chroma + sentence-transformers if installed and initialized;

    falls back to simple keyword ranking. A source's presence is not proof of authenticity.

    """

    sources = load_sources()

    if not sources:

        return []

    try:

        import chromadb

        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

        client = chromadb.PersistentClient(path=str((ROOT / settings.chroma_dir).resolve()))

        collection = client.get_or_create_collection("harikatha_sources")

        existing = collection.get(include=[])

        known_ids = set(existing.get("ids", []))

        new_sources = [s for s in sources if s.get("id") not in known_ids]

        if new_sources:

            embeddings = model.encode([s.get("text", "") for s in new_sources]).tolist()

            collection.add(

                ids=[s["id"] for s in new_sources],

                documents=[s.get("text", "") for s in new_sources],

                metadatas=[{"title": s.get("title", ""), "citation": s.get("citation", ""), "status": s.get("status", "needs_review"), "source_type": s.get("source_type", "unknown")} for s in new_sources],

                embeddings=embeddings,

            )

        result = collection.query(query_embeddings=[model.encode([query])[0].tolist()], n_results=min(limit, len(sources)))

        found_ids = (result.get("ids") or [[]])[0]

        by_id = {s.get("id"): s for s in sources}

        return [by_id[i] for i in found_ids if i in by_id]

    except Exception:

        words = set(re.findall(r"[a-zA-Z]{3,}", query.lower()))

        ranked = []

        for s in sources:

            text = f"{s.get('title','')} {s.get('text','')} {s.get('citation','')}".lower()

            score = sum(1 for word in words if word in text)

            if score:

                ranked.append((score, s))

        ranked.sort(key=lambda x: x[0], reverse=True)

        return [item for _, item in ranked[:limit]]

def detect_scene(text: str) -> str:
    """Detect a likely story scene using simple keyword matching."""
    text = text.lower()

    scene_keywords = {
        "battle": [
            "battle", "war", "kurukshetra", "army", "warrior",
            "arjuna", "bow", "arrows", "chariot", "fight", "weapon", "conch",
        ],
        "storm": [
            "storm", "thunder", "lightning", "heavy rain", "tempest", "flood",
        ],
        "river": [
            "river", "yamuna", "ganga", "banks of the river",
            "crossed the water", "boat", "waterfall",
        ],
        "forest": [
            "forest", "jungle", "trees", "birds chirping", "hermitage",
            "ashram", "wilderness",
        ],
        "temple": [
            "temple", "prayer", "worship", "aarti", "puja", "devotees", "sanctum",
        ],
        "divine": [
            "krishna", "vrindavan", "flute", "radha", "gopis",
            "divine music", "lord vishnu", "lord shiva",
        ],
        "emotional": [
            "wept", "tears", "grief", "sorrow", "separation", "heartbroken", "lamented",
        ],
    }

    # Check dramatic scenes before general devotional references.
    priority = ["battle", "storm", "river", "forest", "temple", "divine", "emotional"]
    for scene in priority:
        if any(keyword in text for keyword in scene_keywords[scene]):
            return scene

    return "devotional"


# Optional scene sound effects. Put any of these MP3 files in backend/sounds/.
# If a scene-specific file is absent, the narration uses tanpura as the ambience bed.
SCENE_SOUND_FILES = {
    "battle": "battle_drums.mp3",
    "storm": "storm.mp3",
    "river": "river.mp3",
    "forest": "forest.mp3",
    "divine": "krishna_flute.mp3",
    "temple": "temple_ambience.mp3",
    "emotional": "emotional_strings.mp3",
    "devotional": "tanpura.mp3",
}


# Phrases that often deserve extra weight in devotional storytelling.
# Keep this list selective: too much emphasis makes the narration sound unnatural.
EMPHASIS_PHRASES = [
    "my confusion has vanished", "perform your duty", "without attachment",
    "divine wisdom", "universal form", "divine form", "eternal soul",
    "the soul is eternal", "O Lord", "Lord Krishna", "I shall act",
    "path of righteousness", "heart filled with sorrow", "my mind is clouded",
    "I cannot fight", "divine radiance", "fear disappeared", "Supreme Lord",
    "divine vision", "the truth", "my duty", "the right path",
]


def split_emphasis_segments(text: str, max_emphasis: int = 2) -> list[tuple[str, bool]]:
    """Split text around up to two meaningful phrases for slower, louder delivery."""
    candidates: list[tuple[int, int, str]] = []
    # Prefer longer phrases first so, for example, 'Lord Krishna' wins over 'Krishna'.
    for phrase in sorted(EMPHASIS_PHRASES, key=len, reverse=True):
        pattern = re.compile(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)", re.IGNORECASE)
        match = pattern.search(text)
        if match:
            candidates.append((match.start(), match.end(), match.group(0)))
    # Choose meaningful multi-word phrases before generic character names.
    candidates.sort(key=lambda item: (-(item[1] - item[0]), item[0]))

    selected: list[tuple[int, int, str]] = []
    for start, end, phrase in candidates:
        if any(start < used_end and end > used_start for used_start, used_end, _ in selected):
            continue
        selected.append((start, end, phrase))
        if len(selected) >= max_emphasis:
            break

    if not selected:
        return [(text, False)]

    selected.sort(key=lambda item: item[0])
    segments: list[tuple[str, bool]] = []
    cursor = 0
    for start, end, phrase in selected:
        if start > cursor:
            before = text[cursor:start]
            if before.strip():
                segments.append((before, False))
        emphasized = text[start:end]
        if emphasized.strip():
            segments.append((emphasized, True))
        cursor = end
    if cursor < len(text) and text[cursor:].strip():
        segments.append((text[cursor:], False))
    return segments or [(text, False)]


SYSTEM_PROMPT = """You are an assistant that drafts culturally respectful Harikatha-style storytelling performances.

Be honest about provenance. NEVER invent Sanskrit verses, scriptural citations, traditional song lyrics, authors, raga names, or tala names. Only quote sacred/traditional text if it appears verbatim in the supplied source excerpts and keep its supplied citation. If no verified source is supplied, omit traditional quotations and use clearly labelled original reflections. Distinguish original lyrics from traditional compositions. Do not claim that original lyrics are traditional. Songs are displayed as lyrics; do not claim to sing. The voice will narrate the generated text.

Return ONLY valid JSON with this schema:

{

  "title": string,

  "language": string,

  "sections": [

    {"type": "invocation|introduction|narration|verse|song|reflection|moral|closing", "title": string, "content": string, "source_ids": [string], "song_metadata": {"kind": "original|traditional", "raga": string|null, "tala": string|null}|null}

  ],

  "content_notes": [string]

}

Include an invocation only if appropriate; it may be an original respectful opening if no verified invocation is supplied, and must be labelled as original. Include a coherent story, natural audience engagement and light respectful humour when suitable, meaningful philosophical reflection, a clear moral and closing. Do not pad with repetitive filler. All section content should be in the requested language, except any original script/source text that is intentionally quoted. Keep the output substantial for the requested duration but obey the output budget."""

@app.get("/api/v1/health")

async def health() -> dict[str, Any]:

    ollama_ok = False

    try:

        async with httpx.AsyncClient(timeout=2.0) as client:

            response = await client.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags")

            ollama_ok = response.status_code == 200

    except Exception:

        pass

    return {"status": "ok", "ollama_reachable": ollama_ok, "model": settings.ollama_model, "piper_configured": bool(settings.piper_model_path and Path(settings.piper_model_path).exists())}

@app.get("/api/v1/capabilities")

async def capabilities() -> dict[str, Any]:

    return {

        "generation": "Ollama local model",

        "configured_model": settings.ollama_model,

        "audio": "Piper local TTS" if settings.piper_model_path and Path(settings.piper_model_path).exists() else "not configured",

        "source_count": len(load_sources()),

        "note": "Source records must be reviewed before their contents are represented as verified tradition.",

    }

@app.get("/api/v1/sources")

async def sources() -> list[dict[str, Any]]:

    return load_sources()

@app.post("/api/v1/harikatha/generate")

async def generate(req: GenerateRequest) -> dict[str, Any]:

    retrieved = retrieve_sources(req.story + " " + req.title)

    source_block = "\n\n".join(

        f"SOURCE ID: {s.get('id')}\nTITLE: {s.get('title')}\nCITATION: {s.get('citation')}\nSTATUS: {s.get('status')}\nTEXT:\n{s.get('text')}"

        for s in retrieved

    ) or "No source excerpts were retrieved. Do not quote or invent traditional verses or songs."

    user_prompt = f"""Create a Harikatha-style performance using this input.

Title: {req.title}

Requested language: {req.language}

Approximate target duration: {req.duration_minutes} minutes

Tone: {req.tone}

Audience: {req.audience}

USER'S STORY:

{req.story}

RETRIEVED SOURCE EXCERPTS (these may be used only with their supplied IDs/citations; retrieval is not itself proof of authenticity):

{source_block}

Create the JSON structure requested in the system instructions. Use source_ids only when the relevant source excerpt directly supports the passage. Do not invent citations. For traditional verses, quote only exact text present in the excerpts. If source quality/status is not verified, do not label the text verified; explain this in content_notes. Song lyrics should be original and labelled original unless a supplied source explicitly contains the traditional lyrics."""

    try:

        async with httpx.AsyncClient(timeout=180.0) as client:

            response = await client.post(

                f"{settings.ollama_base_url.rstrip('/')}/api/chat",

                json={"model": settings.ollama_model, "stream": False, "format": "json", "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_prompt}], "options": {"temperature": 0.65}},

            )

        response.raise_for_status()

        raw = response.json().get("message", {}).get("content", "")

        result = json.loads(raw)

    except httpx.ConnectError as exc:

        raise HTTPException(status_code=503, detail=f"Cannot connect to Ollama at {settings.ollama_base_url}. Install/start Ollama and download model '{settings.ollama_model}'.") from exc

    except httpx.HTTPStatusError as exc:

        raise HTTPException(status_code=502, detail=f"Ollama returned HTTP {exc.response.status_code}. Check that model '{settings.ollama_model}' is installed using 'ollama pull {settings.ollama_model}'.") from exc

    except (json.JSONDecodeError, KeyError, TypeError) as exc:

        raise HTTPException(status_code=502, detail="The local model returned an invalid response. Try again or use a model better suited to structured JSON output.") from exc

    except httpx.TimeoutException as exc:

        raise HTTPException(status_code=504, detail="Generation timed out. Try a shorter story or a smaller local model.") from exc

    if not isinstance(result, dict) or not isinstance(result.get("sections"), list) or not result["sections"]:

        raise HTTPException(status_code=502, detail="The model response did not contain a valid section list.")

    result_id = str(uuid.uuid4())

    source_by_id = {s.get("id"): s for s in retrieved}

    for section in result["sections"]:

        ids = section.get("source_ids", []) if isinstance(section, dict) else []

        section["sources"] = [{"id": sid, "title": source_by_id[sid].get("title"), "citation": source_by_id[sid].get("citation"), "status": source_by_id[sid].get("status")} for sid in ids if sid in source_by_id]

    record = {"id": result_id, "created_at": datetime.now(timezone.utc).isoformat(), "input": req.model_dump(), "performance": result, "retrieved_sources": retrieved, "audio_files": {}}

    all_records = load_performances()

    all_records[result_id] = record

    save_performances(all_records)

    return record

@app.get("/api/v1/harikatha")

async def list_harikathas() -> list[dict[str, Any]]:

    records = load_performances()

    return [{"id": r["id"], "title": r.get("performance", {}).get("title", "Untitled"), "created_at": r.get("created_at"), "language": r.get("performance", {}).get("language", "")} for r in sorted(records.values(), key=lambda x: x.get("created_at", ""), reverse=True)]

@app.get("/api/v1/harikatha/{performance_id}")

async def get_harikatha(performance_id: str) -> dict[str, Any]:

    record = load_performances().get(performance_id)

    if not record:

        raise HTTPException(status_code=404, detail="Performance not found")

    return record

@app.post("/api/v1/harikatha/{performance_id}/narration")
async def generate_full_narration(performance_id: str) -> dict[str, Any]:
    """Generate expressive narration and mix it with scene-matched local ambience."""
    records = load_performances()
    record = records.get(performance_id)
    if not record:
        raise HTTPException(status_code=404, detail="Performance not found")

    model_path = Path(settings.piper_model_path)
    if not settings.piper_model_path or not model_path.exists():
        raise HTTPException(status_code=501, detail="Piper voice model is not configured.")
    if not shutil.which(settings.piper_executable):
        raise HTTPException(status_code=501, detail=f"Piper executable '{settings.piper_executable}' was not found.")

    # Prefer FFmpeg on PATH; use the known Windows installation as a fallback.
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        fallback = Path(r"C:\Users\arsha\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build-shared\bin\ffmpeg.exe")
        ffmpeg = str(fallback) if fallback.exists() else None
    if not ffmpeg:
        raise HTTPException(status_code=501, detail="FFmpeg was not found. Install it and make sure ffmpeg.exe is on PATH.")

    sounds_dir = Path(__file__).resolve().parent.parent / "sounds"
    tanpura_path = sounds_dir / "tanpura.mp3"
    bell_path = sounds_dir / "temple_bell.mp3"
    if not tanpura_path.exists():
        raise HTTPException(status_code=500, detail="Missing backend/sounds/tanpura.mp3 background sound file.")

    sections = record.get("performance", {}).get("sections", [])
    if not sections:
        raise HTTPException(status_code=400, detail="This performance has no sections.")
    usable_sections = [sec for sec in sections if isinstance(sec, dict) and str(sec.get("content", "")).strip()]
    if not usable_sections:
        raise HTTPException(status_code=400, detail="No narration text was found.")

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    clip_paths: list[Path] = []
    concat_file = AUDIO_DIR / f"{performance_id}_concat.txt"
    filename = f"{performance_id}_full.wav"
    audio_path = AUDIO_DIR / filename

    try:
        for index, section in enumerate(usable_sections):
            section_text = f"{section.get('title', '')}.\n{section.get('content', '')}".strip()
            scene = detect_scene(f"{section.get('title', '')} {section.get('content', '')}")
            effect_name = SCENE_SOUND_FILES.get(scene, "tanpura.mp3")
            effect_path = sounds_dir / effect_name
            # Avoid mixing tanpura twice when it is the selected scene ambience.
            if not effect_path.exists() or effect_path.resolve() == tanpura_path.resolve():
                effect_path = None

            voice_path = AUDIO_DIR / f"{performance_id}_voice_{index}.wav"
            clip_path = AUDIO_DIR / f"{performance_id}_clip_{index}.wav"

            # Synthesize normal text normally, but give up to two key phrases per section
            # a slightly slower delivery and a modest volume lift. Piper is not a fully
            # expressive TTS engine; this is a local/offline approximation of word emphasis.
            segments = split_emphasis_segments(section_text, max_emphasis=2)
            part_paths: list[Path] = []
            for part_index, (part_text, emphasized) in enumerate(segments):
                part_path = AUDIO_DIR / f"{performance_id}_voice_{index}_part_{part_index}.wav"
                piper_cmd = [settings.piper_executable, "--model", str(model_path)]
                if emphasized:
                    piper_cmd += ["--length_scale", "0.88"]
                piper_cmd += ["--output_file", str(part_path)]
                proc = subprocess.run(
                    piper_cmd, input=part_text, text=True, capture_output=True, timeout=600, check=False,
                )
                if proc.returncode != 0 or not part_path.exists():
                    raise HTTPException(status_code=502, detail=f"Piper failed for section {index + 1}: {(proc.stderr or proc.stdout)[-1000:]}")
                part_paths.append(part_path)

            # Join the voice pieces, making emphasized phrases slightly louder and adding
            # a tiny pause after them so they land clearly in the narration.
            voice_cmd = [ffmpeg, "-y"]
            voice_filters: list[str] = []
            voice_labels: list[str] = []
            for part_index, (_, emphasized) in enumerate(segments):
                voice_cmd += ["-i", str(part_paths[part_index])]
                label = f"vp{part_index}"
                if emphasized:
                    voice_filters.append(f"[{part_index}:a]volume=1.35,apad=pad_dur=0.10[{label}]")
                else:
                    voice_filters.append(f"[{part_index}:a]anull[{label}]")
                voice_labels.append(f"[{label}]")
            voice_filters.append("".join(voice_labels) + f"concat=n={len(part_paths)}:v=0:a=1[voiceout]")
            voice_cmd += ["-filter_complex", ";".join(voice_filters), "-map", "[voiceout]", "-c:a", "pcm_s16le", str(voice_path)]
            voice_join = subprocess.run(voice_cmd, capture_output=True, text=True, timeout=600, check=False)
            if voice_join.returncode != 0 or not voice_path.exists():
                raise HTTPException(status_code=502, detail=f"Could not assemble emphasized narration for section {index + 1}: {(voice_join.stderr or voice_join.stdout)[-1500:]}")

            # Narrator is deliberately clearer/louder than ambience; background sounds stay subtle.
            cmd = [ffmpeg, "-y", "-i", str(voice_path), "-stream_loop", "-1", "-i", str(tanpura_path)]
            filters = [
                "[0:a]volume=1.20,acompressor=threshold=0.12:ratio=2:attack=20:release=250[voice]",
                "[1:a]volume=0.16[music]",
            ]
            mix_inputs = "[voice][music]"
            input_count = 2
            if effect_path:
                cmd += ["-stream_loop", "-1", "-i", str(effect_path)]
                filters.append("[2:a]volume=0.22[scene]")
                mix_inputs += "[scene]"
                input_count += 1
            if index == 0 and bell_path.exists():
                cmd += ["-i", str(bell_path)]
                bell_input = input_count
                filters.append(f"[{bell_input}:a]volume=0.35,adelay=500,atrim=duration=4[bell]")
                mix_inputs += "[bell]"
                input_count += 1
            filters.append(f"{mix_inputs}amix=inputs={input_count}:duration=first:dropout_transition=2:normalize=0[out]")
            cmd += ["-filter_complex", ";".join(filters), "-map", "[out]", "-c:a", "pcm_s16le", str(clip_path)]
            mix = subprocess.run(cmd, capture_output=True, text=True, timeout=600, check=False)
            if mix.returncode != 0 or not clip_path.exists():
                raise HTTPException(status_code=502, detail=f"Audio mixing failed for section {index + 1}: {(mix.stderr or mix.stdout)[-1500:]}")
            clip_paths.append(clip_path)

        # Concatenate the mixed section clips in their original order.
        concat_file.write_text("\n".join(f"file '{str(path).replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'" for path in clip_paths), encoding="utf-8")
        joined = subprocess.run(
            [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c:a", "pcm_s16le", str(audio_path)],
            capture_output=True, text=True, timeout=600, check=False,
        )
        if joined.returncode != 0 or not audio_path.exists():
            raise HTTPException(status_code=502, detail=f"Could not join narration clips: {(joined.stderr or joined.stdout)[-1500:]}")
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Narration generation or audio mixing timed out.") from exc
    finally:
        # Keep the final WAV only; remove intermediate clips/voice tracks and concat list.
        for pattern in (f"{performance_id}_voice_*.wav", f"{performance_id}_clip_*.wav"):
            for path in AUDIO_DIR.glob(pattern):
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
        concat_file.unlink(missing_ok=True)

    record.setdefault("audio_files", {})["full"] = filename
    records[performance_id] = record
    save_performances(records)
    return {"audio_url": f"/api/v1/audio/{filename}", "filename": filename}


@app.post("/api/v1/harikatha/{performance_id}/audio/{section_index}")
async def generate_audio(performance_id: str, section_index: int) -> dict[str, Any]:

    records = load_performances()

    record = records.get(performance_id)

    if not record:

        raise HTTPException(status_code=404, detail="Performance not found")

    if not settings.piper_model_path or not Path(settings.piper_model_path).exists():

        raise HTTPException(status_code=501, detail="Piper voice model is not configured. Download a compatible Piper .onnx voice and set PIPER_MODEL_PATH in backend/.env. See README.md.")

    sections = record.get("performance", {}).get("sections", [])

    if section_index < 0 or section_index >= len(sections):

        raise HTTPException(status_code=404, detail="Section index not found")

    if not shutil.which(settings.piper_executable):

        raise HTTPException(status_code=501, detail=f"Piper executable '{settings.piper_executable}' was not found. Install piper-tts and ensure the executable is on PATH.")

    section = sections[section_index]

    filename = f"{performance_id}_{section_index}.wav"

    audio_path = AUDIO_DIR / filename

    try:

        proc = subprocess.run([settings.piper_executable, "--model", settings.piper_model_path, "--output_file", str(audio_path)], input=section.get("content", ""), text=True, capture_output=True, timeout=180, check=False)

        if proc.returncode != 0 or not audio_path.exists():

            raise HTTPException(status_code=502, detail=f"Piper failed to generate audio: {(proc.stderr or proc.stdout)[-1000:]}")

    except subprocess.TimeoutExpired as exc:

        raise HTTPException(status_code=504, detail="Audio generation timed out") from exc

    record.setdefault("audio_files", {})[str(section_index)] = filename

    records[performance_id] = record

    save_performances(records)

    return {"audio_url": f"/api/v1/audio/{filename}", "section_index": section_index, "filename": filename}

@app.get("/api/v1/audio/{filename}")

async def get_audio(filename: str):

    if Path(filename).name != filename:

        raise HTTPException(status_code=400, detail="Invalid filename")

    path = AUDIO_DIR / filename

    if not path.exists() or path.suffix.lower() != ".wav":

        raise HTTPException(status_code=404, detail="Audio file not found")

    return FileResponse(path, media_type="audio/wav", filename=filename)
