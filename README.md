# MathVis‑Agent
数学几何可视化Agent平台
FastAPI后端 + 大模型LLM + Upstash Redis会话 + Three.js前端
大模型接收数学题目，输出面向学生的自然语言解题推导，同时生成结构化3D动画帧指令，实现文字推导+三维图形演示。

## 项目分工
1. 后端（1号）：FastAPI服务、Redis会话管理、大模型调用、异常兼容处理
2. 前端（2号）：网页UI、用户输入框、自然语言文字渲染、Three.js 3D画布解析渲染
3. 测试（3号）：整机流程测试，反馈前后端Bug

## 仓库地址
https://github.com/liono34/MathVis-Agent

## 环境依赖
Python >= 3.12

## 后端启动步骤
1.克隆项目
git clone https://github.com/liono34/MathVis-Agent.git
cd MathVis-Agent/backend

2.创建并激活虚拟环境
python -m venv agent_env
.\agent_env\Scripts\Activate.ps1

3.安装依赖
pip install -r requirements.txt

4.新建 .env 配置文件（backend目录下）
ZHIPU_API_KEY=你的智谱API密钥
LLM_MODEL=glm-4.7-flash
REDIS_URL=你的Upstash Redis完整连接地址

APP_ENV=development
DEBUG=True

5.启动后端服务
uvicorn main:app --reload --host 0.0.0.0 --port 8000

接口文档访问地址：
http://127.0.0.1:8000/docs

## 接口说明
### 1. POST /api/text‑question
保存用户输入的数学题目，存入Redis会话
Query参数：
- session_id：会话唯一标识

返回示例
{
  "ok": true,
  "session_id": "test001"
}

### 2. POST /api/agent‑run
执行大模型推理，生成解题文本与3D动画帧
Query参数：
- session_id：会话id

返回固定JSON结构
{
  "ok": true,
  "hit_kb": false,
  "qid": "",
  "analysis": "面向用户的自然语言解题推导文本",
  "image_path": "",
  "threejs_anim": {
    "title": "演示标题",
    "frames": []
  }
}

### 3. DELETE /api/session/{session_id}
清空Redis中对应会话，切换新题目时调用。

## 前端对接说明
1. ok === true 才正常渲染页面；ok为false展示错误提示（模型繁忙、调用失败等）
2. analysis 字段：直接原样渲染到网页文字区域，给普通用户阅读，保留换行
3. threejs_anim 整块为机器指令，不给用户展示，交给JS解析
    frames[]：动画帧数组
    camera：三维相机参数
    objects：每一帧渲染的物体、颜色、位置、旋转参数
4. image_path 为空字符串时，忽略图片渲染。
5. hit_kb无论true/false，返回字段结构保持不变。

### 前端业务流程
1. 用户输入题目 → 请求 /api/text‑question 存入会话
2. 请求 /api/agent‑run 拿到后端返回JSON
3. 分流渲染：
    analysis → HTML普通DOM文字面板
    threejs_anim → 独立Three.js Canvas画布
4. 更换题目：调用delete接口清空旧session

特性：三维模块渲染异常时，文字解析部分依然可以正常展示。

## 当前版本状态
- ✅后端无RAG模式完整跑通
- ⏳RAG本地知识库功能待迭代开发
- ⏳图片OCR上传接口为占位模板，后续迭代实现

## 开发提交命令
git add .
git commit -m "本次改动描述"
git push
