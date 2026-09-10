import os
import time
import redis
from dotenv import load_dotenv

load_dotenv()
REDIS_URL = os.getenv("REDIS_URL", "")
print(f"DEBUG 读到的REDIS_URL: {REDIS_URL}")

redis_client = redis.Redis.from_url(
    REDIS_URL,
    socket_timeout=20,
    socket_connect_timeout=20,
    retry_on_timeout=True,
    health_check_interval=30
)

# 启动时尝试连接，重试3次；仍失败也不让后端崩溃（改为懒连接，网络恢复后自动可用）
_ok = False
for _i in range(3):
    try:
        redis_client.ping()
        print("✅ Upstash Redis 连接成功")
        _ok = True
        break
    except Exception as _e:
        print(f"⚠️ Redis 第{_i+1}次连接失败: {_e}")
        time.sleep(2)

if not _ok:
    print("❌ Redis 暂时连不上，后端仍会启动；请检查网络/代理，恢复后再操作登录注册")
