import requests
import os
from dotenv import load_dotenv

load_dotenv()

BAIZHI_API_KEY = os.getenv("BAIZHI_API_KEY")

def recognize_formula_image(image_bytes: bytes) -> str:
    """
    百智视觉接口：传入图片二进制字节，返回识别出的题目文本
    image_bytes：上传文件原始bytes
    return：识别得到的题干字符串
    """
    headers = {
        "Authorization": f"Bearer {BAIZHI_API_KEY}"
    }
    files = {
        "image": ("upload.jpg", image_bytes, "image/jpeg")
    }
    # =========这里替换成百智图片识别真实接口地址=========
    resp = requests.post(
        "你的百智视觉公式识别接口地址",
        headers=headers,
        files=files,
        timeout=30
    )
    resp.raise_for_status()
    res_json = resp.json()

    # ⚠根据百智实际返回json，提取文本字段，这里只是占位示例
    ocr_result = res_json.get("result", "")
    return ocr_result
