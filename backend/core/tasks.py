from celery import Celery
from config import settings

# 自动选择云端/本地Redis作为消息队列
if settings.REDIS_URL and len(settings.REDIS_URL.strip())>0:
    broker_url = settings.REDIS_URL
else:
    broker_url = f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"

celery_app = Celery("math_agent", broker=broker_url, backend=broker_url)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
)
