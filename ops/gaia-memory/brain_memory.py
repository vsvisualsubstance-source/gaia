import os
import sys
import uuid
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="GAIA Long-Term Memory Core")

# Copia gemella di /home/core/D/gaia-brain/brain_memory.py (fuori dal repo,
# non versionato), deployata su OPS per la Gaia Portable (2026-10-15):
# Node-RED vive su OPS da tempo (cutover 2026-08-08) ma questo servizio
# restava solo su Core, con l'URL del nodo QdrantStore (flows.json)
# hardcoded a "localhost:8000" -- funzionava per puro caso quando Node-RED
# E questo girava sulla stessa macchina (Core, pre-cutover), rotto da
# allora senza che nessuno se ne accorgesse (sintomo: pensieri/lexicon/
# sogno sempre vuoti, _lastMemCount sempre 0). QDRANT_URL/OLLAMA_URL qui
# sotto diventano configurabili via env apposta per questo deploy --
# Qdrant su OPS e' containerizzato (porta host 16333, non 6333 nativo
# come su Core), Ollama e' nativo (11434, stesso default). Propagare ogni
# modifica strutturale anche all'originale su Core.
QDRANT_URL = os.getenv("GAIA_QDRANT_URL", "http://localhost:6333")
OLLAMA_URL = os.getenv("GAIA_OLLAMA_URL", "http://localhost:11434")
COLLECTION_NAME = "gaia_memory_large"
EMBEDDING_MODEL = "mxbai-embed-large"

if sys.platform == "win32":
    class _RotatingConsole:
        """pythonw.exe non ha una console reale -- stesso meccanismo di
        ops/agent/agent.py, ops/dhcp/dhcp_server.py, ops/osc-bridge/osc_bridge.py."""

        def __init__(self, path, max_bytes=10 * 1024 * 1024, backups=3):
            self._path = path
            self._max_bytes = max_bytes
            self._backups = backups
            self._fh = open(path, "a", encoding="utf-8", errors="replace")

        def write(self, s):
            try:
                self._fh.write(s)
                self._fh.flush()
                if self._fh.tell() >= self._max_bytes:
                    self._rotate()
            except Exception:
                pass
            return len(s)

        def flush(self):
            try:
                self._fh.flush()
            except Exception:
                pass

        def isatty(self):
            return False

        def _rotate(self):
            try:
                self._fh.close()
                for i in range(self._backups - 1, 0, -1):
                    src, dst = f"{self._path}.{i}", f"{self._path}.{i + 1}"
                    if os.path.exists(src):
                        if os.path.exists(dst):
                            os.remove(dst)
                        os.rename(src, dst)
                if os.path.exists(self._path):
                    dst1 = f"{self._path}.1"
                    if os.path.exists(dst1):
                        os.remove(dst1)
                    os.rename(self._path, dst1)
            finally:
                self._fh = open(self._path, "a", encoding="utf-8", errors="replace")

    try:
        _DIR = os.path.dirname(os.path.abspath(__file__))
        sys.stdout = sys.stderr = _RotatingConsole(os.path.join(_DIR, "brain_memory.log"))
    except Exception:
        pass

try:
    requests.put(
        f"{QDRANT_URL}/collections/{COLLECTION_NAME}",
        json={"vectors": {"size": 1024, "distance": "Cosine"}},
        timeout=10
    )
except Exception:
    pass

class MemoryEntry(BaseModel):
    text: str
    category: str = "conversation"
    importance: int = 5
    metadata: dict = {}

def get_embedding(text: str):
    try:
        # Timeout esplicito (trovato dal vivo 2026-08-18): senza, una chiamata
        # lenta (Ollama in contesa CPU con qwen2.5) restava appesa per minuti,
        # esaurendo il threadpool di uvicorn e facendo apparire il servizio
        # come "no response from server" lato Node-RED per QUALSIASI /remember,
        # non solo quello lento.
        response = requests.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBEDDING_MODEL, "prompt": text},
            timeout=30
        )
        return response.json()["embedding"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore: {str(e)}")

@app.post("/remember")
def remember(entry: MemoryEntry):
    vector = get_embedding(entry.text)
    point_id = str(uuid.uuid4())
    
    payload = {
        "points": [
            {
                "id": point_id,
                "vector": vector,
                "payload": {
                    "text": entry.text,
                    "category": entry.category,
                    "importance": entry.importance,
                    "metadata": entry.metadata
                }
            }
        ]
    }
    
    try:
        requests.put(
            f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points?wait=true",
            json=payload,
            timeout=15
        )
        return {"status": "success", "memory_id": point_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore: {str(e)}")

@app.get("/recall")
def recall(query: str, limit: int = 3):
    query_vector = get_embedding(query)
    
    payload = {
        "vector": query_vector,
        "limit": limit,
        "with_payload": True
    }
    
    try:
        response = requests.post(
            f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points/search",
            json=payload,
            timeout=15
        )
        search_result = response.json().get("result", [])
        memories = [hit["payload"]["text"] for hit in search_result if hit.get("score", 0) > 0.45]
        return {"query": query, "recalled_memories": memories}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
