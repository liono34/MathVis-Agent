import re

def clean_latex_for_json(raw_text: str) -> str:
    """
    清洗LLM返回文本，修复LaTeX反斜杠，避免JSON转义异常
    将单独的单个\ 替换成双反斜杠 \\
    不会重复替换已经是\\的内容
    """
    if not raw_text:
        return raw_text
    # 匹配单独的反斜杠（前后都不是\）
    cleaned = re.sub(r'(?<!\\)\\(?!\\)', r'\\\\', raw_text)
    return cleaned
