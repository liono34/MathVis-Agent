from fastapi import FastAPI, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
import json
import os
import re
from dotenv import load_dotenv
from utils.redis_client import redis_client
# 知识库模块暂未启用
# from utils.rag_kb import load_math_kb
from utils.image_recognize import recognize_formula_image
from langchain_openai import ChatOpenAI
from utils.text_clean import clean_latex_for_json
from auth import router as auth_router

load_dotenv()
app = FastAPI(title="MathVis-Agent后端")

# 跨域中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载登录/注册/审核路由
app.include_router(auth_router)

ZHIPU_API_KEY = os.getenv("ZHIPU_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "glm-4.7-flash")
llm = ChatOpenAI(
    api_key=ZHIPU_API_KEY,
    base_url="https://open.bigmodel.cn/api/paas/v4/",
    model=LLM_MODEL,
    temperature=0.3
)


# 清洗1：把0x十六进制转十进制
def hex_js_to_decimal(text: str) -> str:
    pattern = re.compile(r"0x[0-9a-fA-F]+")

    def replace_hex(match):
        return str(int(match.group(), 16))

    return pattern.sub(replace_hex, text)


# 清洗2：去除markdown ```json 标记，只保留{}之间内容
def extract_json_body(raw: str) -> str:
    raw = re.sub(r"```(json)?", "", raw)
    match = re.search(r"\{[\s\S]*\}", raw)
    if match:
        return match.group(0)
    return raw


# 注意：system_prompt 用普通字符串 + replace，绝不用 f-string
# （JSON示例里的大括号会被 f-string 当成占位符导致 KeyError）
SYSTEM_PROMPT_TEMPLATE = """
你是数学几何可视化Agent。
已知知识库例题列表：
__KB_LIST__
用户问题：__QUESTION__

【图形类型判定规则】
一、如果题目是3D立体几何或空间解析几何曲面，生成 geo 对象，threejs_anim 填 null。
geo 的 shape 只能从以下9种里选，params 必须严格对应：
1. 长方体 cuboid: {"shape":"cuboid","params":{"width":数字,"depth":数字,"height":数字}}
2. 球体 sphere: {"shape":"sphere","params":{"radius":数字}}
3. 圆柱 cylinder: {"shape":"cylinder","params":{"radius":数字,"height":数字}}
4. 圆锥 cone: {"shape":"cone","params":{"radius":数字,"height":数字}}
5. 椭球 ellipsoid: {"shape":"ellipsoid","params":{"a":数字,"b":数字,"c":数字}}
6. 单叶双曲面 hyperboloid1: {"shape":"hyperboloid1","params":{"a":数字,"b":数字,"c":数字}}
7. 双叶双曲面 hyperboloid2: {"shape":"hyperboloid2","params":{"a":数字,"b":数字,"c":数字}}
8. 抛物面 paraboloid: {"shape":"paraboloid","params":{"a":数字,"b":数字,"height":数字}}
9. 圆环面 torus: {"shape":"torus","params":{"R":数字,"r":数字}}

二、如果题目是2D平面图形、函数图像或定积分，生成 threejs_anim 对象，geo 填 null。
threejs_anim 的 type 只能从以下5种里选：
1. 任意函数图像 function: {"type":"function","func":"x^2+1","xMin":-5,"xMax":5}
   func 里用 x 作变量，支持 sin cos tan ln log sqrt ^ 等，例如 "ln(x)"、"sin(x)"、"x^2"
2. 定积分 integral: {"type":"integral","func":"ln(x)","a":1,"b":2}
3. 圆 circle: {"type":"circle","params":{"radius":数字}}
4. 椭圆 ellipse: {"type":"ellipse","params":{"a":数字,"b":数字}}
5. 三角形 triangle: {"type":"triangle","p1":[0,0],"p2":[4,0],"p3":[2,3]}

三、纯代数、纯计算、没有图形的题目：geo 填 null，threejs_anim 填 null。

【输出硬性规则】
1. 判断是否和知识库例题高度匹配：命中则 hit_kb=true 并复用其字段；不命中 hit_kb=false，qid 与 image_path 为空字符串。
2. 只返回纯JSON，禁止任何多余文字、注释、markdown、```json标记，直接输出JSON对象。
3. 颜色字段不要用0x十六进制，一律用十进制数字。

输出字段约定：
{
"hit_kb": 布尔,
"qid": "字符串",
"analysis": "解题文字解析",
"image_path": "字符串",
"threejs_anim": 2D对象 或 null,
"geo": 3D对象 或 null
}
"""


# 1. 文字录入题目
@app.post("/api/text-question")
async def text_question(
    session_id: str = Query(...),
    question: str = Query(...)
):
    key = f"session:{session_id}"
    history_raw = redis_client.get(key)
    history = json.loads(history_raw) if history_raw else []
    history.append({"role": "user", "content": question})
    redis_client.set(key, json.dumps(history))
    return {"ok": True, "session_id": session_id}


# 2. 图片上传OCR识别录入题目
@app.post("/api/upload-image")
async def upload_image_question(
    session_id: str = Query(...),
    file: UploadFile = File(...)
):
    img_bytes = await file.read()
    try:
        q_text = recognize_formula_image(img_bytes)
    except Exception as e:
        return {"ok": False, "error": f"图片识别失败:{str(e)}"}
    key = f"session:{session_id}"
    history_raw = redis_client.get(key)
    history = json.loads(history_raw) if history_raw else []
    history.append({"role": "user", "content": q_text})
    redis_client.set(key, json.dumps(history))
    return {"ok": True, "session_id": session_id, "ocr_text": q_text}


# 3. 获取会话
@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    key = f"session:{session_id}"
    data = redis_client.get(key)
    if not data:
        return {"ok": True, "history": []}
    return {"ok": True, "history": json.loads(data)}


# 4. 清空会话
@app.delete("/api/session/{session_id}")
async def del_session(session_id: str):
    redis_client.delete(f"session:{session_id}")
    return {"ok": True}


# 5. 核心Agent运行接口
@app.post("/api/agent-run")
async def agent_run(session_id: str = Query(...)):
    key = f"session:{session_id}"
    history_raw = redis_client.get(key)
    if not history_raw:
        return {"ok": False, "error": "会话不存在，请先输入题目"}
    history = json.loads(history_raw)
    user_question = history[-1]["content"]
    kb_list = []  # 知识库暂未启用

    system_prompt = (
        SYSTEM_PROMPT_TEMPLATE
        .replace("__KB_LIST__", json.dumps(kb_list, ensure_ascii=False))
        .replace("__QUESTION__", user_question)
    )

    messages = [{"role": "system", "content": system_prompt}] + history
    raw_text = ""
    try:
        resp = llm.invoke(messages)
        raw_text = resp.content.strip()
        # 多层清洗
        raw_text = extract_json_body(raw_text)
        raw_text = hex_js_to_decimal(raw_text)
        raw_text = clean_latex_for_json(raw_text)
        result = json.loads(raw_text)
        return {
            "ok": True,
            "hit_kb": result.get("hit_kb"),
            "qid": result.get("qid", ""),
            "analysis": result.get("analysis", ""),
            "image_path": result.get("image_path", ""),
            "threejs_anim": result.get("threejs_anim"),
            "geo": result.get("geo", None)
        }
    except Exception as e:
        return {
            "ok": False,
            "error": "大模型调用或者JSON解析失败",
            "llm_raw": raw_text,
            "detail": str(e)
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
