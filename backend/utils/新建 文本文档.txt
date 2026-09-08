import os
import redis
from dotenv import load_dotenv

load_dotenv()
REDIS_URL = os.getenv("REDIS_URL")
print(f"DEBUG 读到的REDIS_URL: {REDIS_URL}")

try:
    redis_client = redis.from_url(REDIS_URL)
    redis_client.ping()
    print("✅ Upstash Redis 连接成功")
except Exception as e:
    print(f"❌ Redis连接失败:{e}")
    raise e
