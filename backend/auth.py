"""
注册登录接口（前端全部通过 HTTP API 调用）
统一返回结构 {"ok": true/false, ...}，错误时附带 "error" 说明，方便前端提示

接口清单：
  POST /api/auth/register                注册（学生直接生效，老师进待审核）
  POST /api/auth/login                   登录，返回令牌
  POST /api/auth/logout                  退出登录，作废令牌
  GET  /api/auth/me                      查询当前登录用户
  GET  /api/auth/admin/users             管理员查看用户（默认只看待审核老师）
  POST /api/auth/admin/users/{id}/approve 管理员通过老师审核
  POST /api/auth/admin/users/{id}/reject  管理员驳回老师审核
"""
import hmac
import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from utils import user_store
from utils.security import hash_password, new_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["认证"])

# 先加载 .env，保证下面读到的配置不受模块导入顺序影响
load_dotenv()

# 令牌有效期，默认7天
TOKEN_EXPIRE_SECONDS = int(os.getenv("AUTH_TOKEN_EXPIRE_SECONDS", "604800"))
# 管理员令牌，只有拿到它才能审核老师账号
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

# 用户名：3-20位中英文、数字、下划线
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$")
# 用户名不存在时也跑一次哈希校验，避免通过响应快慢猜出哪些用户名已被注册
_DUMMY_HASH = hash_password("mathvis-dummy-password")


class RegisterBody(BaseModel):
    username: str = ""
    password: str = ""
    role: str = user_store.ROLE_STUDENT


class LoginBody(BaseModel):
    username: str = ""
    password: str = ""


class ReviewBody(BaseModel):
    note: str = ""


def _fail(status_code: int, message: str) -> JSONResponse:
    """统一的失败响应"""
    return JSONResponse(status_code=status_code, content={"ok": False, "error": message})


def _bearer_token(authorization: str) -> str:
    """从 Authorization: Bearer xxx 请求头里取出令牌"""
    if not authorization:
        return ""
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return ""


def _validate_username(username: str) -> str:
    if not username:
        return "请输入用户名"
    if not _USERNAME_RE.match(username):
        return "用户名需为3-20位中英文、数字或下划线"
    return ""


def _validate_password(password: str) -> str:
    if not password:
        return "请输入密码"
    if len(password) < 6 or len(password) > 64:
        return "密码长度需为6-64位"
    return ""


def _issue_token(user: dict) -> str:
    """签发登录令牌并写入Redis"""
    token = new_token()
    user_store.save_token(token, user["user_id"], TOKEN_EXPIRE_SECONDS)
    return token


def _check_admin(admin_token: str) -> str:
    """校验管理员令牌，通过返回空字符串，否则返回错误说明"""
    if not ADMIN_TOKEN:
        return "后端未配置 ADMIN_TOKEN，无法执行审核操作"
    if not admin_token:
        return "管理员令牌不正确"
    # 用字节比较，避免令牌里出现非ASCII字符时 compare_digest 报错
    if not hmac.compare_digest(admin_token.encode("utf-8"), ADMIN_TOKEN.encode("utf-8")):
        return "管理员令牌不正确"
    return ""


def get_current_user(authorization: str = Header(default="")) -> dict:
    """
    鉴权依赖：业务接口挂上它，就必须带合法令牌才能访问
    成功后返回当前登录用户的公开信息（含 user_id、role）
    """
    user = user_store.get_token_user(_bearer_token(authorization))
    if not user:
        raise HTTPException(status_code=401, detail="未登录或登录已过期，请重新登录")
    if user.get("status") != user_store.STATUS_ACTIVE:
        raise HTTPException(status_code=403, detail="账号状态异常，请联系管理员")
    return user_store.public_view(user)


@router.post("/register")
async def register(body: RegisterBody):
    """注册：学生直接可用，老师需管理员审核通过后才能登录"""
    username = body.username.strip()
    error = _validate_username(username) or _validate_password(body.password)
    if error:
        return _fail(400, error)
    if body.role not in user_store.ROLES:
        return _fail(400, "请选择正确的用户身份")

    try:
        user = user_store.create_user(username, hash_password(body.password), body.role)
    except ValueError as e:
        return _fail(409, str(e))
    except Exception as e:
        return _fail(500, f"注册失败:{e}")

    info = user_store.public_view(user)
    # 老师注册后不能直接登录，返回待审核状态让前端提示
    if user.get("status") == user_store.STATUS_PENDING:
        return {
            "ok": True,
            "status": user_store.STATUS_PENDING,
            "user": info,
            "message": "老师账号已提交，请等待管理员审核通过后再登录",
        }

    token = _issue_token(user)
    return {
        "ok": True,
        "status": user_store.STATUS_ACTIVE,
        "token": token,
        "expires_in": TOKEN_EXPIRE_SECONDS,
        "user": info,
        "message": "注册成功",
    }


@router.post("/login")
async def login(body: LoginBody):
    """登录：校验密码并签发令牌"""
    username = body.username.strip()
    if not username or not body.password:
        return _fail(400, "请输入用户名和密码")

    user = user_store.get_user_by_username(username)
    if not user:
        # 用户名不存在时也做一次等价耗时的密码校验，避免通过响应快慢猜出哪些用户名已注册
        verify_password(body.password, _DUMMY_HASH)
        return _fail(401, "用户名或密码错误")
    if not verify_password(body.password, user.get("password_hash", "")):
        return _fail(401, "用户名或密码错误")

    status = user.get("status")
    if status == user_store.STATUS_PENDING:
        return _fail(403, "老师账号正在审核中，请等待管理员通过")
    if status == user_store.STATUS_REJECTED:
        note = user.get("review_note") or ""
        return _fail(403, f"老师账号审核未通过{('：' + note) if note else ''}")

    token = _issue_token(user)
    return {
        "ok": True,
        "token": token,
        "expires_in": TOKEN_EXPIRE_SECONDS,
        "user": user_store.public_view(user),
        "message": "登录成功",
    }


@router.post("/logout")
async def logout(authorization: str = Header(default="")):
    """退出登录：作废当前令牌"""
    user_store.delete_token(_bearer_token(authorization))
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    """查询当前登录用户，供前端刷新页面时恢复登录态"""
    return {"ok": True, "user": user}


@router.get("/admin/users")
async def admin_list_users(
    status: str = Query(default=user_store.STATUS_PENDING),
    x_admin_token: str = Header(default="")
):
    """管理员查看用户列表，默认只看待审核的老师"""
    error = _check_admin(x_admin_token)
    if error:
        return _fail(403, error)
    if status and status not in user_store.STATUSES:
        return _fail(400, "审核状态不合法")
    users = user_store.list_users(status)
    return {"ok": True, "users": users, "total": len(users)}


@router.post("/admin/users/{user_id}/approve")
async def admin_approve(
    user_id: str,
    body: Optional[ReviewBody] = None,
    x_admin_token: str = Header(default="")
):
    """管理员通过老师注册申请"""
    error = _check_admin(x_admin_token)
    if error:
        return _fail(403, error)
    user = user_store.set_user_status(
        user_id,
        user_store.STATUS_ACTIVE,
        (body.note if body else "") or "审核通过"
    )
    if not user:
        return _fail(404, "用户不存在")
    return {"ok": True, "user": user_store.public_view(user), "message": "已通过审核"}


@router.post("/admin/users/{user_id}/reject")
async def admin_reject(
    user_id: str,
    body: Optional[ReviewBody] = None,
    x_admin_token: str = Header(default="")
):
    """管理员驳回老师注册申请"""
    error = _check_admin(x_admin_token)
    if error:
        return _fail(403, error)
    user = user_store.set_user_status(
        user_id,
        user_store.STATUS_REJECTED,
        (body.note if body else "") or "审核未通过"
    )
    if not user:
        return _fail(404, "用户不存在")
    return {"ok": True, "user": user_store.public_view(user), "message": "已驳回"}
