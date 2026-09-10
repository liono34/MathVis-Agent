"""
用户与令牌存储：复用项目已有的 Upstash Redis（redis_client）
键设计：
  auth:name:{用户名小写}  -> user_id      用户名唯一索引
  auth:user:{user_id}     -> 用户JSON
  auth:token:{token}      -> user_id      登录令牌（带过期）
  auth:users:index        -> user_id集合  管理员列表用
"""
import json
import time
import secrets

from utils.redis_client import redis_client

ROLE_STUDENT = "student"
ROLE_TEACHER = "teacher"
ROLES = (ROLE_STUDENT, ROLE_TEACHER)

STATUS_ACTIVE = "active"
STATUS_PENDING = "pending"
STATUS_REJECTED = "rejected"
STATUSES = (STATUS_ACTIVE, STATUS_PENDING, STATUS_REJECTED)

_USERS_INDEX_KEY = "auth:users:index"


def _user_key(user_id):
    return f"auth:user:{user_id}"


def _name_key(username):
    return f"auth:name:{username.lower()}"


def _token_key(token):
    return f"auth:token:{token}"


def _to_str(v):
    if isinstance(v, bytes):
        return v.decode("utf-8")
    return v


def _now():
    return int(time.time())


def create_user(username: str, password_hash: str, role: str) -> dict:
    if redis_client.get(_name_key(username.lower())):
        raise ValueError("用户名已被注册")

    user_id = "u_" + secrets.token_hex(8)
    user = {
        "user_id": user_id,
        "username": username,
        "password_hash": password_hash,
        "role": role if role in ROLES else ROLE_STUDENT,
        # 学生直接生效，老师进待审核
        "status": STATUS_PENDING if role == ROLE_TEACHER else STATUS_ACTIVE,
        "created_at": _now(),
        "review_note": ""
    }
    redis_client.set(_user_key(user_id), json.dumps(user, ensure_ascii=False))
    redis_client.set(_name_key(username.lower()), user_id)
    redis_client.sadd(_USERS_INDEX_KEY, user_id)
    return user


def get_user_by_id(user_id: str):
    raw = redis_client.get(_user_key(user_id))
    if not raw:
        return None
    return json.loads(_to_str(raw))


def get_user_by_username(username: str):
    user_id = redis_client.get(_name_key(username.lower()))
    if not user_id:
        return None
    return get_user_by_id(_to_str(user_id))


def save_token(token: str, user_id: str, expire_seconds: int):
    redis_client.set(_token_key(token), user_id)
    try:
        redis_client.expire(_token_key(token), int(expire_seconds))
    except Exception:
        pass


def get_token_user(token: str):
    if not token:
        return None
    user_id = redis_client.get(_token_key(token))
    if not user_id:
        return None
    return get_user_by_id(_to_str(user_id))


def delete_token(token: str):
    if token:
        redis_client.delete(_token_key(token))


def public_view(user: dict):
    """返回给前端的用户信息，去掉密码哈希"""
    if not user:
        return None
    return {
        "user_id": user.get("user_id"),
        "username": user.get("username"),
        "role": user.get("role"),
        "status": user.get("status"),
        "created_at": user.get("created_at")
    }


def list_users(status: str = None):
    ids = redis_client.smembers(_USERS_INDEX_KEY) or set()
    result = []
    for uid in ids:
        u = get_user_by_id(_to_str(uid))
        if not u:
            continue
        if status and u.get("status") != status:
            continue
        result.append(public_view(u))
    return result


def set_user_status(user_id: str, status: str, note: str = ""):
    user = get_user_by_id(user_id)
    if not user:
        return None
    user["status"] = status
    user["review_note"] = note or ""
    redis_client.set(_user_key(user_id), json.dumps(user, ensure_ascii=False))
    return user
