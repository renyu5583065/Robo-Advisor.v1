# Robo-Advisor：投資人風險評估 × MPT 資產配置

問卷評出投資人風險類型，再用 Python 最佳化（現代投資組合理論）依類型產生資產配置。選股可隨時更換，流程不變。

## 特色

- **兩階段問卷**：10 題選擇題計算風險分數與類型，6 題開放式問題觀察行為與情緒反應
- **LLM 分析（長庚大學 CGU API）**：第二階段可改由 LLM 評估 7 項行為指標，並附上依據原句；沒有金鑰或呼叫失敗時，退回關鍵字比對
- **MPT 資產配置**：依風險分數設定目標風險，在風險上限內以 `scipy` 最佳化求出權重；標的可替換
- **精簡後端**：只用 Node 內建模組，不需 `npm install`

線上版問卷：<https://robo-advisorv1-renyu.up.railway.app/>

## Quick Start

需求：Node ≥ 20.12、Python 3（`pip install numpy pandas scipy matplotlib`）

```bash
# 問卷網頁 → http://127.0.0.1:3000
npm start

# 啟用 LLM（長庚大學 CGU API，選用）
cp .env.example .env      # 填入 LLM_API_KEY（到 https://air.cgu.edu.tw/workspace4/LLMAPI/index.php 申請）
npm start                 # 結果頁會標示用的是 LLM 還是關鍵字分析
```

`.env` 可另設 `LLM_BASE_URL`（預設 `https://air.cgu.edu.tw/cgullmapi/v1`）、`LLM_MODEL`（預設 `gpt-6-luna`）。金鑰只存在後端，`.env` 不會被提交。

伺服器預設只監聽 `127.0.0.1:3000`；設定了 `PORT` 或在 Railway 上執行時改聽 `0.0.0.0`（也可用 `HOST` 覆寫）。

## 資料流程

![資料流程](data_flow.png)

左側主流程：暱稱 → 10 題選擇題 → 風險上限檢核 → 有效風險分數 → Python 最佳化 → 建議投資組合。
右側行為分析支線：6 題開放式問答 → LLM（或關鍵字備援）→ 行為指標與偏誤警示；目前只顯示與記錄，不影響配置。

## 專案結構

```text
index.html, css/        單頁問卷介面與樣式
js/                     前端邏輯：questions*.js 題目、scoring.js 風險計分、sentiment.js 行為分析、
                        app*.js 流程控制、chart.js／vendor/chartjs 圖表
server/server.js        靜態檔案 + API（零相依套件）
server/llm.js           CGU LLM 呼叫（輸出 JSON、格式錯誤重試）
portfolio/              價格 CSV 與 Python 分析腳本、輸出的表格與圖
Dockerfile              Node + Python 合併映像，供 Railway 部署
```

### API

| 路由 | 說明 |
| --- | --- |
| `POST /api/portfolio` | 傳入風險分數，伺服器呼叫 Python 最佳化後回傳權重（逾時 30 秒） |
| `POST /api/analyze` | 第二階段 LLM 分析；未設 `LLM_API_KEY` 回 503，前端改用關鍵字分析 |
| `POST /api/submissions` | 記錄一份問卷結果（含暱稱） |
| `GET /api/submissions` | 列出已記錄的結果（僅供本機查看） |

## Minimal Example

### 換股後重跑 MPT 分析

把標的的歷史價格 CSV 放進 `portfolio/`（舊的刪掉）。格式：UTF-16、Tab 分隔，需有「年月日」（`YYYYMMDD`）與「收盤價(元)」欄位，檔名即資產代號。

```bash
cd portfolio && python Return_and_Risk_Analysis.py   # 1. 清理、報酬、共變異數、相關性
cd .. && python portfolio/MPT_Opportunity_Set_MVP.py # 2. 機會集合、MVP、效率前緣（需在根目錄執行）
python portfolio/Risk_Based_Allocation.py            # 3. 三種風險類型的最適配置
python portfolio/Risk_Based_Allocation.py --score 55 # 　 選用：用風險分數（0–100）算一組
```

網頁結果的「建議投資組合」不是事先算好的：使用者按下按鈕時，網頁把風險分數送到 `POST /api/portfolio`，
Node 伺服器呼叫 `python portfolio/Risk_Based_Allocation.py --score <分數> --json`，由 Python 用 `scipy` 即時最佳化後回傳權重。
因此執行網站的環境要有 Python 與 `requirements.txt` 的套件（部署用的 `Dockerfile` 已包含）。

### 分析流程

```text
各檔 CSV ─ 只留共同交易日 ─ 日報酬率 ─ 年化 μ（均值×252）、Σ（共變異數×252）
                                          │
問卷風險分數(0–100) ─ 目標風險 = σ_MVP + 分數/100 × (σ_最大報酬 − σ_MVP)
                                          │
        max μᵀw   s.t.  √(wᵀΣw) ≤ 目標風險,  Σw = 1,  0 ≤ w ≤ 40%     (SLSQP)
                                          │
        權重 → allocation_by_risk_type.csv ／ allocation_summary.txt ／ 圖表
```

- **風險分數**（`js/scoring.js`）：10 題各 1–5 分，依權重加權平均（損失承受、提款需求、投資期限各 15%；年齡、資產、收入各 10%；目標、偏好各 7.5%；知識、經驗各 5%），`(平均 − 1) ÷ 4 × 100` 得 0–100 分。
- **投資人類型**：加權平均 < 2.34 保守、< 3.68 穩健、其餘積極。另有兩條「只降不升」上限：客觀能力題的加權平均、以及單題硬性條件（1 年內要用錢、無其他資金又需提款、跌 20% 嚴重影響生活 → 最高穩健型）。
- **三種類型的代表分數**：16.75 / 50.25 / 83.5（各分數區間中點）。
- **類型被上限調降時**：基準風險分數維持不變，但送去最佳化的是「有效分數」＝ `min(基準分數, 最終類型區間的上緣)`（保守 33.5、穩健 67），確保配置與顯示的類型一致。結果頁會顯示兩個分數（`js/scoring.js` 的 `effectiveScore`）。
- **單一資產上限**（`MAX_WEIGHT`）、**無風險利率**（`RISK_FREE`）、**年化天數** 在腳本頂端調整。
- **第二階段**：LLM 對 7 項指標（焦慮、損失規避、自信、從眾、過度自信、確認偏誤、處置效應）各給 1–5 分；關鍵字版則由 3 分起算，命中「提高／降低」關鍵字各 ±0.8。
- 預期報酬用歷史平均，結果高度依賴資料期間，僅供教學，非投資建議。

### 輸出

| 檔案 | 內容 |
| --- | --- |
| `portfolio/allocation_by_risk_type.csv` | 各類型權重、報酬、風險、夏普 |
| `portfolio/allocation_summary.txt` | 白話配置建議 |
| `portfolio/efficient_frontier_by_type.png` | 效率前緣與三類型配置點 |
| `portfolio/allocation_comparison.png` | 三類型配置比較 |
| `Efficient_Frontier.png`、`MVP_Weights.png` | 機會集合、MVP（無權重上限） |
| `data/submissions.json` | 問卷結果（`POST/GET /api/submissions`，僅本機、不提交） |

## 部署（Railway / Docker）

```bash
docker build -t robo-advisor .
docker run -p 3000:3000 -e PORT=3000 -e LLM_API_KEY=你的金鑰 robo-advisor
```

映像以 `node:22-slim` 為底，另建 Python venv 安裝 `requirements.txt`，並以 `PYTHON_BIN` 指向它；`LLM_API_KEY` 請設為平台環境變數。

## 備註

僅供學校作業繳交使用，非商業用途；問卷題目參考國泰世華銀行「投資屬性分析」。
