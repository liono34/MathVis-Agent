import json
import os

KB_FILE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "rag_data", "math_kb.json")

def load_math_kb():
    if not os.path.exists(KB_FILE_PATH):
        return []
    try:
        with open(KB_FILE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception:
        return []
