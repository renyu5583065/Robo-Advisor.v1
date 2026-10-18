"""
Risk_Based_Allocation.py

【功能說明】
依投資人風險類型（保守型 / 穩健型 / 積極型）自動計算並產出最適資產配置：
1. 讀取 clean_prices.csv 歷史價格，計算年化預期報酬率向量與年化共變異數矩陣。
2. 風險分數線性映射至目標風險（年化波動度）：
     目標風險 = 最小風險 + (分數 / 100) × (最大風險 - 最小風險)
   - 最小風險：最小變異數投資組合 (MVP) 的風險。
   - 最大風險：在權重上限內報酬最高組合的風險。
3. 數值最佳化求解：在「風險不超過目標風險」的約束下，求解預期報酬最大的投資組合（落在效率前緣上）。
4. 匯出成果：
   - 輸出配置權重 CSV 報表與說明文字檔。
   - 自動生成前端網頁所需的 js/portfolio-data.js 資料檔。
   - 繪製效率前緣曲線圖與資產配置堆疊長條圖。

執行方式：python portfolio/Risk_Based_Allocation.py [--score 0~100] [--show]
"""

# 1. 模組載入與全域設定 (Configuration & Setup)
import argparse              # 命令列參數解析套件
from pathlib import Path     # 物件導向路徑操作套件

import matplotlib            # 繪圖函式庫底層
import numpy as np           # 高效矩陣與數值運算套件
import pandas as pd          # 資料表分析與處理套件
import scipy.optimize as solver # 數值最佳化求解套件

# 路徑設定：確保從任何目錄執行本指令碼時，都能精確定位到同目錄下的檔案
HERE = Path(__file__).resolve().parent
PRICE_FILE = HERE / "clean_prices.csv"

# 金融分析參數
TRADING_DAYS = 252   # 一年約有 252 個交易日（用於日數據年化）
RISK_FREE = 0.02     # 無風險利率（設為 2%，用於計算夏普值 Sharpe Ratio）
MAX_WEIGHT = 0.40   # 單一資產配置上限（40%），防止積極型投資人資金全押在單一標的以控制集中度風險

# 資產分類與中文名稱字典（用於說明與圖表）
ASSET_CLASS = {
    "0050": "股票", "2330": "股票", "2412": "股票", "2882": "股票", "00662": "股票",
    "00635U": "黃金", "00679B": "債券", "00712": "不動產",
}
ASSET_NAME = {
    "0050": "元大台灣50", "00635U": "元大S&P黃金", "00662": "富邦NASDAQ",
    "00679B": "元大美債20年", "00712": "復華富時不動產",
    "2330": "台積電", "2412": "中華電", "2882": "國泰金",
}
ASSET_NAME_EN = {  # 英文名稱（提供 Matplotlib 英文圖表使用，避免預設中文字型缺字）
    "0050": "Yuanta Taiwan 50", "00635U": "Yuanta S&P Gold", "00662": "Fubon NASDAQ",
    "00679B": "Yuanta US 20Y Treasury", "00712": "FH FTSE REITs",
    "2330": "TSMC", "2412": "Chunghwa Telecom", "2882": "Cathay Financial",
}

# 風險類型門檻：與網頁問卷 (js/scoring.js) 的門檻嚴格對齊
# 1–5 分加權平均門檻 2.34 與 3.68，轉換成 0–100 分即為 33.5 與 67.0
THRESHOLDS = (33.5, 67.0)
RISK_TYPES = [
    {"key": "conservative", "name": "保守型", "label": "Conservative", "score": (0 + THRESHOLDS[0]) / 2},
    {"key": "moderate", "name": "穩健型", "label": "Moderate", "score": (THRESHOLDS[0] + THRESHOLDS[1]) / 2},
    {"key": "aggressive", "name": "積極型", "label": "Aggressive", "score": (THRESHOLDS[1] + 100) / 2},
]


# 2. 資料讀取與統計量運算 (Data Loading & Statistics)

def load_inputs():
    """
    讀取歷史收盤價，計算日報酬率，並換算為年化期望報酬率與年化共變異數矩陣
    """
    prices = pd.read_csv(PRICE_FILE, index_col=0, parse_dates=True)
    returns = prices.pct_change().dropna()
    mu = returns.mean() * TRADING_DAYS            # 年化期望報酬率 (向量)
    cov = returns.cov() * TRADING_DAYS            # 年化共變異數矩陣 (矩陣)
    return prices, mu, cov


def stats(w, mu, cov):
    """
    計算給定權重配置 w 時的投資組合績效三要素：預期年化報酬率、年化波動度（風險）、夏普值
    @param w: 各資產權重向量
    @param mu: 各資產年化報酬率向量
    @param cov: 年化共變異數矩陣
    @return: (預期報酬率, 年化風險, 夏普值)
    """
    ret = float(w @ mu)
    risk = float(np.sqrt(w @ cov.values @ w))
    sharpe = (ret - RISK_FREE) / risk if risk > 0 else 0.0
    return ret, risk, sharpe


def clean_weights(w):
    """
    清理權重浮點數微小誤差：小於 1e-6 的數值直接歸零，並重新正規化使總和嚴格等於 1
    """
    w = np.where(np.abs(w) < 1e-6, 0.0, w)
    return w / w.sum()


# 3. MPT 投資組合最佳化演算法 (Portfolio Optimization Engine)

def min_variance(mu, cov, target_return=None):
    """
    求解最小風險投資組合：
    - 若未指定 target_return：求全域最小變異數組合 (MVP)
    - 若指定 target_return：求在達成該目標報酬率的前提下，風險最小的配置點（效率前緣上的點）
    """
    n = len(mu)
    cons = [{"type": "eq", "fun": lambda w: w.sum() - 1}] # 約束：權重總和為 1
    if target_return is not None:
        # 約束：投資組合報酬率必須等於 target_return
        cons.append({"type": "eq", "fun": lambda w: w @ mu.values - target_return})
    # 使用 SLSQP 演算法求解非線性約束最佳化
    res = solver.minimize(
        lambda w: np.sqrt(w @ cov.values @ w), # 目標函數：最小化標準差
        x0=np.full(n, 1 / n),
        bounds=[(0, MAX_WEIGHT)] * n,          # 邊界：不放空且單檔不超過上限
        constraints=cons,
        method="SLSQP",
        options={"ftol": 1e-12, "maxiter": 500},
    )
    if not res.success:
        raise RuntimeError(f"最小變異數最佳化失敗：{res.message}")
    return clean_weights(res.x)


def max_return(mu):
    """
    在單檔權重上限 (MAX_WEIGHT) 限制下，求解預期報酬率最高的組合
    此為線性規劃問題 (Linear Programming)，使用 HiGHS 求解器求得精確解
    """
    n = len(mu)
    # linprog 預設求解最小化，因此目標向量取負值 (-mu) 相當於求最大化
    res = solver.linprog(
        -mu.values,
        A_eq=np.ones((1, n)),
        b_eq=[1],
        bounds=[(0, MAX_WEIGHT)] * n,
        method="highs"
    )
    if not res.success:
        raise RuntimeError(f"最大報酬最佳化失敗：{res.message}")
    return clean_weights(res.x)


def max_return_given_risk(mu, cov, target_risk, start):
    """
    核心演算法：在投資組合波動度不超過 target_risk 的前提下，最大化預期報酬率
    @param target_risk: 目標風險上限（波動度）
    @param start: 最佳化迭代起始權重
    """
    n = len(mu)
    cons = [
        {"type": "eq", "fun": lambda w: w.sum() - 1}, # 資金完全配置：Σw = 1
        # 不等式約束：target_risk² - wᵀ·Cov·w >= 0（組合變異數不得超過目標變異數）
        {"type": "ineq", "fun": lambda w: target_risk**2 - w @ cov.values @ w},
    ]
    # 目標函數：最小化 -(w @ mu)，即最大化預期報酬率
    res = solver.minimize(
        lambda w: -(w @ mu.values),
        x0=start,
        bounds=[(0, MAX_WEIGHT)] * n,
        constraints=cons,
        method="SLSQP",
        options={"ftol": 1e-12, "maxiter": 500},
    )
    if not res.success:
        raise RuntimeError(f"風險上限最佳化失敗：{res.message}")
    return clean_weights(res.x)


def allocation_for_score(score, mu, cov, anchors):
    """
    將使用者的 0–100 基準風險分數轉換為最適投資配置：
    1. 線性插值計算對應的目標波動度 target_risk
    2. 呼叫 max_return_given_risk 求得最適權重
    """
    w_min, w_max = anchors
    risk_lo = stats(w_min, mu, cov)[1] # 最小風險端點 (MVP)
    risk_hi = stats(w_max, mu, cov)[1] # 最大風險端點
    target = risk_lo + score / 100 * (risk_hi - risk_lo)
    return max_return_given_risk(mu, cov, target, start=w_min), target


def efficient_frontier(mu, cov, w_min, w_max, points=60):
    """
    在最小報酬與最大報酬之間切出多個點，計算繪製效率前緣 (Efficient Frontier) 所需的曲線座標 (風險, 報酬)
    """
    ret_lo = stats(w_min, mu, cov)[0]
    ret_hi = stats(w_max, mu, cov)[0]
    rows = []
    for target in np.linspace(ret_lo, ret_hi, points):
        w = min_variance(mu, cov, target)
        rows.append((stats(w, mu, cov)[1], target))
    return np.array(rows)


# 4. 投資配置說明與文字摘要 (Summary & Advice Generation)

def class_totals(weights):
    """
    將各資產的配置權重按資產類別（股票、債券、黃金、不動產）進行分類加總
    """
    totals = {}
    for asset, w in weights.items():
        cls = ASSET_CLASS.get(asset, "其他")
        totals[cls] = totals.get(cls, 0) + w
    return totals


def plain_advice(name, weights, ret, risk):
    """
    產生適合一般投資人閱讀的淺白配置說明文字
    """
    # 篩選持股比例大於等於 5% 的主要配置標的
    top = weights[weights >= 0.05].sort_values(ascending=False)
    holdings = "、".join(f"{ASSET_NAME.get(a, a)}（{a}）{w:.0%}" for a, w in top.items())
    # 統計各大資產類別佔比
    classes = "、".join(f"{k} {v:.0%}" for k, v in sorted(class_totals(weights).items(), key=lambda x: -x[1]) if v >= 0.005)
    return (
        f"【{name}】主要持有：{holdings}。\n"
        f"  資產類別：{classes}。\n"
        f"  以過去資料估算，年化報酬約 {ret:.1%}，年化波動約 {risk:.1%}；"
        f"也就是說，帳面在一年內上下起伏約 {risk:.0%} 是常見的情況。"
    )


# 5. 前端網頁資料匯出 (Web Data Export)

def write_web_data(path, assets, mu, cov, prices):
    """
    將計算所得之統計矩陣匯出為前端使用的 js/portfolio-data.js 檔案，
    讓前端可在使用者做完問卷時，於瀏覽器端即時跑最佳化運算。
    """
    import json

    data = {
        "maxWeight": MAX_WEIGHT,
        "riskFree": RISK_FREE,
        "period": [str(prices.index[0].date()), str(prices.index[-1].date())],
        "assets": [
            {"code": a, "name": ASSET_NAME.get(a, a), "assetClass": ASSET_CLASS.get(a, "其他")}
            for a in assets
        ],
        "mu": [float(x) for x in mu.values],
        "cov": [[float(x) for x in row] for row in cov.values],
    }
    body = json.dumps(data, ensure_ascii=False, indent=2)
    path.write_text(
        "/* 由 portfolio/Risk_Based_Allocation.py 自動產生，請勿手動修改。 */\n"
        "window.RoboAdvisor = window.RoboAdvisor || {};\n"
        f"RoboAdvisor.portfolioData = {body};\n",
        encoding="utf-8",
    )


# 6. Matplotlib 圖表繪製 (Visualization & Plotting)

def plot_frontier(path, frontier, mu, cov, results, w_min, show):
    """
    繪製效率前緣曲線，並標示各風險類型（保守/穩健/積極）的最佳配置點與單一資產散點
    """
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(11, 7))
    # 繪製效率前緣線
    ax.plot(
        frontier[:, 0], frontier[:, 1], color="#251f6b", linewidth=2.2,
        label=f"Efficient Frontier (max weight {MAX_WEIGHT:.0%})"
    )

    # 繪製單一資產個別風險報酬散點
    single_risk = pd.Series(np.sqrt(np.diag(cov.values)), index=mu.index)
    ax.scatter(single_risk, mu, color="grey", s=35, zorder=3)
    for name in mu.index:
        ax.annotate(
            name, (single_risk[name], mu[name]), textcoords="offset points",
            xytext=(5, 5), fontsize=8, color="dimgrey"
        )

    # 標記三大風險類型的最佳配置點
    colors = {"conservative": "#14b8a6", "moderate": "#1d2e5c", "aggressive": "#c97c13"}
    for t in RISK_TYPES:
        r = results[t["key"]]
        ax.scatter(
            r["risk"], r["return"], s=260, marker="*", color=colors[t["key"]],
            edgecolor="black", zorder=5, label=f"{t['label']} (score {t['score']:.0f})"
        )
    # 標記全域最小風險 MVP 點
    mvp_ret, mvp_risk, _ = stats(w_min, mu, cov)
    ax.scatter(mvp_risk, mvp_ret, s=70, marker="D", color="red", edgecolor="black", zorder=4, label="MVP")

    ax.spines["right"].set_visible(False)
    ax.spines["top"].set_visible(False)
    ax.set_title("Efficient Frontier and Portfolios by Investor Risk Type", fontsize=16, fontweight="bold")
    ax.set_xlabel("Risk (Annualized Volatility)")
    ax.set_ylabel("Expected Return (Annualized)")
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(path, dpi=300)
    if not show:
        plt.close(fig)


def plot_allocation(path, weight_table, show):
    """
    繪製不同風險類型下的資產配置堆疊長條圖 (Stacked Bar Chart)
    """
    import matplotlib.pyplot as plt

    labels = [t["label"] for t in RISK_TYPES]
    fig, ax = plt.subplots(figsize=(9, 7))
    palette = plt.get_cmap("tab10").colors
    bottom = np.zeros(len(labels))

    # 逐一為各資產繪製堆疊長條
    for i, asset in enumerate(weight_table.index):
        vals = weight_table.loc[asset, [t["key"] for t in RISK_TYPES]].values.astype(float) * 100
        ax.bar(
            labels, vals, bottom=bottom, color=palette[i % 10], edgecolor="white",
            label=f"{asset} {ASSET_NAME_EN.get(asset, '')}".strip()
        )
        # 若該資產佔比 >= 4%，在長條中央標註百分比數值
        for x, (v, b) in enumerate(zip(vals, bottom)):
            if v >= 4:
                ax.text(x, b + v / 2, f"{v:.0f}%", ha="center", va="center", fontsize=9, color="white", fontweight="bold")
        bottom += vals

    ax.set_ylabel("Weight (%)")
    ax.set_ylim(0, 100)
    ax.set_title("Asset Allocation by Investor Risk Type", fontsize=16, fontweight="bold")
    ax.spines["right"].set_visible(False)
    ax.spines["top"].set_visible(False)
    ax.legend(loc="center left", bbox_to_anchor=(1.01, 0.5), fontsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=300)
    if not show:
        plt.close(fig)


# 7. 主程式進入點 (Main Entry Point)

def main():
    # 命令列參數解析
    parser = argparse.ArgumentParser(description="依投資人風險類型做 MPT 最適配置")
    parser.add_argument("--score", type=float, help="另外替一個 0–100 的基準風險分數（網頁問卷結果）算出配置")
    parser.add_argument("--show", action="store_true", help="執行完開啟圖表視窗")
    args = parser.parse_args()

    if args.score is not None and not 0 <= args.score <= 100:
        parser.error("--score 必須介於 0 到 100")
    # 若未指定 --show，使用無介面之後端 Agg 避免伺服器端環境報錯
    if not args.show:
        matplotlib.use("Agg")

    # 載入資料並計算年化統計量
    prices, mu, cov = load_inputs()
    assets = list(mu.index)
    print(f"資料期間：{prices.index[0].date()} ~ {prices.index[-1].date()}，共 {len(prices)} 個共同交易日")
    print(f"資產：{assets}；單一資產權重上限 {MAX_WEIGHT:.0%}；無風險利率 {RISK_FREE:.1%}")

    # 計算最小風險 (MVP) 與最大報酬端點
    w_min = min_variance(mu, cov)
    w_max = max_return(mu)
    anchors = (w_min, w_max)
    risk_lo, risk_hi = stats(w_min, mu, cov)[1], stats(w_max, mu, cov)[1]
    print(f"可行風險範圍：{risk_lo:.2%}（MVP）~ {risk_hi:.2%}（最大報酬組合）")

    # 針對三種風險類型（以及自訂分數）進行最佳化求解
    results, tables = {}, {}
    to_run = list(RISK_TYPES)
    if args.score is not None:
        to_run.append({"key": "custom", "name": "自訂分數", "label": "Custom", "score": args.score})

    for t in to_run:
        w, target = allocation_for_score(t["score"], mu, cov, anchors)
        ret, risk, sharpe = stats(w, mu, cov)
        # 驗證約束：權重總和為 1、無負權重（不放空）、無超標權重
        assert abs(w.sum() - 1) < 1e-9 and (w >= -1e-9).all() and (w <= MAX_WEIGHT + 1e-9).all()
        assert risk <= target + 1e-6, "風險超過目標"
        results[t["key"]] = {"weights": pd.Series(w, index=assets), "return": ret, "risk": risk, "sharpe": sharpe, "target": target}
        tables[t["key"]] = t

    # 計算 1/N 等權重比較基準
    eq = np.full(len(assets), 1 / len(assets))
    eq_ret, eq_risk, eq_sharpe = stats(eq, mu, cov)

    # 整合報表並輸出 CSV 檔案
    weight_table = pd.DataFrame({k: r["weights"] for k, r in results.items()})
    summary = pd.DataFrame(
        {k: {"Risk Score": tables[k]["score"], "Target Volatility": r["target"], "Expected Return": r["return"],
             "Volatility": r["risk"], "Sharpe Ratio": r["sharpe"]} for k, r in results.items()}
    )
    out = pd.concat([weight_table, summary])
    out.to_csv(HERE / "allocation_by_risk_type.csv", encoding="utf-8-sig")

    # 終端機格式化輸出
    pd.set_option("display.width", 200)
    print("\n=== 各風險類型的最適配置（權重）===")
    print(weight_table.map(lambda x: f"{x:.1%}").to_string())
    print("\n=== 風險報酬比較 ===")
    print(summary.round(4).to_string())
    print(f"\n（等權重基準：報酬 {eq_ret:.2%}，風險 {eq_risk:.2%}，夏普 {eq_sharpe:.2f}）")

    # 產出說明文字並儲存
    lines = []
    for k, r in results.items():
        lines.append(plain_advice(tables[k]["name"] + f"（分數 {tables[k]['score']:.0f}）", r["weights"], r["return"], r["risk"]))
    advice = "\n\n".join(lines) + (
        "\n\n注意：預期報酬使用過去的歷史平均，不代表未來表現；以上為教學用的模型結果，不是個人化投資建議。"
    )
    print("\n=== 說明 ===")
    print(advice)
    (HERE / "allocation_summary.txt").write_text(advice + "\n", encoding="utf-8")

    # 匯出資料給網頁前端
    write_web_data(HERE.parent / "js" / "portfolio-data.js", assets, mu, cov, prices)

    # 繪製圖表並存檔
    frontier = efficient_frontier(mu, cov, w_min, w_max)
    plot_frontier(HERE / "efficient_frontier_by_type.png", frontier, mu, cov, results, w_min, args.show)
    plot_allocation(HERE / "allocation_comparison.png", weight_table, args.show)
    print("\n[檔案輸出] allocation_by_risk_type.csv、allocation_summary.txt、efficient_frontier_by_type.png、allocation_comparison.png")

    if args.show:
        import matplotlib.pyplot as plt
        plt.show()


if __name__ == "__main__":
    main()
