import os
import base64
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

load_dotenv()

ZHIPU_API_KEY = os.getenv("ZHIPU_API_KEY", "")

# 智谱免费视觉模型，和文字模型共用同一个key
vision_llm = ChatOpenAI(
    api_key=ZHIPU_API_KEY,
    base_url="https://open.bigmodel.cn/api/paas/v4/",
    model="glm-4v-flash",
    temperature=0.1,
    max_tokens=1024
)

def recognize_formula_image(image_bytes: bytes) -> str:
    """
    智谱视觉模型识别：传入图片二进制字节，返回识别出的题目文本
    image_bytes：上传文件原始bytes
    return：识别得到的题干字符串（公式用LaTeX）
    """
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    # 根据文件头判断图片类型
    if image_bytes[:3] == b'\xff\xd8\xff':
        mime = "image/jpeg"
    elif image_bytes[:8] == b'\x89PNG\r\n\x1a\n':
        mime = "image/png"
    elif image_bytes[:4] == b'RIFF':
        mime = "image/webp"
    else:
        mime = "image/jpeg"
    data_url = f"data:{mime};base64,{b64}"

    msg = HumanMessage(content=[
        {
            "type": "text",
            "text": "请识别这张图片中的数学题目，完整输出题目文字。数学公式用LaTeX表示，用$包裹。只输出题目本身，不要输出解析、答案或任何多余说明。"
        },
        {
            "type": "image_url",
            "image_url": {"url": data_url}
        }
    ])

    resp = vision_llm.invoke([msg])
    text = resp.content.strip()
    if not text:
        raise Exception("视觉模型未识别出文字")
    return text
