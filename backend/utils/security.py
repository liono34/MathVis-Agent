"""
密码哈希与令牌生成（纯标准库实现，无需额外依赖）
"""
import hashlib
import hmac
import secrets

_PBKDF2_ITERATIONS = 120000


def hash_password(password: str) -> str:
    """对明文密码做 PBKDF2-SHA256 加盐哈希，返回可存储字符串"""
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        _PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """校验明文密码与存储的哈希是否匹配，任何异常都返回False"""
    try:
        _, iterations, salt, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt),
            int(iterations)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def new_token() -> str:
    """生成登录令牌"""
    return secrets.token_urlsafe(32)
