# Node 伺服器 + Python（scipy 最佳化）放在同一個容器裡，供 Railway 部署使用
FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先裝 Python 套件（requirements.txt 沒變就能用快取）
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PYTHON_BIN=/opt/venv/bin/python

COPY . .

CMD ["npm", "start"]
