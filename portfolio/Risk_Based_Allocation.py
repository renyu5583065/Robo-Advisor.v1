"""
依投資人風險類型（保守 / 穩健 / 積極）自動產生最適資產配置。

流程：
  1. 讀取 clean_prices.csv，計算年化預期報酬與年化共變異數矩陣。
  2. 風險分數 -> 目標風險：
       目標風險 = 最小風險 + (分數 / 100) × (最大風險 - 最小風險)
     最小風險 = 最小變異數投資組合 (MVP) 的風險；
     最大風險 = 「報酬最高的可行投資組合」的風險。
  3. 最佳化：在「風險不超過目標風險」的條件下，最大化預期報酬（落在效率前緣上）。
  4. 輸出三種類型的權重、風險報酬、白話建議，以及效率前緣與配置比較圖。

權重全部由 scipy 最佳化產生，沒有預先寫死。
執行：python portfolio/Risk_Based_Allocation.py [--score 0~100] [--show]
（路徑以程式所在資料夾為準，從哪裡執行都可以。）
"""

import argparse
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
import scipy.optimize as solver

HERE = Path(__file__).resolve().parent
PRICE_FILE = HERE / "clean_prices.csv"

TRADING_DAYS = 252
RISK_FREE = 0.02      # 無風險利率（與 MPT_Opportunity_Set_MVP.py 一致）
MAX_WEIGHT = 0.40    # 單一資產權重上限，避免積極型整個押在單一標的

# 資產分類與名稱（只用於白話建議與圖表說明；換股後沒列在這裡的代號會直接顯示代號、歸為「其他」）
ASSET_CLASS = {
    "0050": "股票", "2330": "股票", "2412": "股票", "2882": "股票", "00662": "股票",
    "00635U": "黃金", "00679B": "債券", "00712": "不動產",
}
ASSET_NAME = {
    "0050": "元大台灣50", "00635U": "元大S&P黃金", "00662": "富邦NASDAQ",
    "00679B": "元大美債20年", "00712": "復華富時不動產",
    "2330": "台積電", "2412": "中華電", "2882": "國泰金",
}
ASSET_NAME_EN = {  # 圖表用（matplotlib 預設字型沒有中文）
    "0050": "Yuanta Taiwan 50", "00635U": "Yuanta S&P Gold", "00662": "Fubon NASDAQ",
    "00679B": "Yuanta US 20Y Treasury", "00712": "FH FTSE REITs",
    "2330": "TSMC", "2412": "Chunghwa Telecom", "2882": "Cathay Financial",
}

# 風險類型：與網頁問卷 (js/scoring.js) 的門檻一致。
# 加權平均 2.34 / 3.68 換成 0–100 分 ((平均 - 1) / 4 × 100) 為 33.5 / 67.0，
# 各類型取分數區間的中點作為代表分數。
THRESHOLDS = (33.5, 67.0)
RISK_TYPES = [
    {"key": "conservative", "name": "保守型", "label": "Conservative", "score": (0 + THRESHOLDS[0]) / 2},
    {"key": "moderate", "name": "穩健型", "label": "Moderate", "score": (THRESHOLDS[0] + THRESHOLDS[1]) / 2},
    {"key": "aggressive", "name": "積極型", "label": "Aggressive", "score": (THRESHOLDS[1] + 100) / 2},
]


# ---------- 資料 ----------

def load_inputs():
    prices = pd.read_csv(PRICE_FILE, index_col=0, parse_dates=True)
    returns = prices.pct_change().dropna()
    mu = returns.mean() * TRADING_DAYS            # 年化預期報酬
    cov = returns.cov() * TRADING_DAYS            # 年化共變異數矩陣
    return prices, mu, cov


def stats(w, mu, cov):
    ret = float(w @ mu)
    risk = float(np.sqrt(w @ cov.values @ w))
    sharpe = (ret - RISK_FREE) / risk
    return ret, risk, sharpe


def clean_weights(w):
    w = np.where(np.abs(w) < 1e-6, 0.0, w)
    return w / w.sum()


# ---------- 最佳化 ----------

def min_variance(mu, cov, target_return=None):
    """最小風險組合；有給 target_return 時就是效率前緣上該報酬的點。"""
    n = len(mu)
    cons = [{"type": "eq", "fun": lambda w: w.sum() - 1}]
    if target_return is not None:
        cons.append({"type": "eq", "fun": lambda w: w @ mu.values - target_return})
    res = solver.minimize(
        lambda w: np.sqrt(w @ cov.values @ w),
        x0=np.full(n, 1 / n), bounds=[(0, MAX_WEIGHT)] * n,
        constraints=cons, method="SLSQP", options={"ftol": 1e-12, "maxiter": 500},
    )
    if not res.success:
        raise RuntimeError(f"最小變異數最佳化失敗：{res.message}")
    return clean_weights(res.x)


def max_return(mu):
    """在權重上限內報酬最高的組合（線性規劃，必有精確解）。"""
    n = len(mu)
    res = solver.linprog(
        -mu.values, A_eq=np.ones((1, n)), b_eq=[1], bounds=[(0, MAX_WEIGHT)] * n, method="highs"
    )
    if not res.success:
        raise RuntimeError(f"最大報酬最佳化失敗：{res.message}")
    return clean_weights(res.x)


def max_return_given_risk(mu, cov, target_risk, start):
    """風險不超過 target_risk 時，報酬最高的組合。"""
    n = len(mu)
    cons = [
        {"type": "eq", "fun": lambda w: w.sum() - 1},
        {"type": "ineq", "fun": lambda w: target_risk**2 - w @ cov.values @ w},
    ]
    res = solver.minimize(
        lambda w: -(w @ mu.values),
        x0=start, bounds=[(0, MAX_WEIGHT)] * n,
        constraints=cons, method="SLSQP", options={"ftol": 1e-12, "maxiter": 500},
    )
    if not res.success:
        raise RuntimeError(f"風險上限最佳化失敗：{res.message}")
    return clean_weights(res.x)


def allocation_for_score(score, mu, cov, anchors):
    """風險分數 (0–100) -> 目標風險 -> 最佳配置。"""
    w_min, w_max = anchors
    risk_lo = stats(w_min, mu, cov)[1]
    risk_hi = stats(w_max, mu, cov)[1]
    target = risk_lo + score / 100 * (risk_hi - risk_lo)
    return max_return_given_risk(mu, cov, target, start=w_min), target


def efficient_frontier(mu, cov, w_min, w_max, points=60):
    ret_lo = stats(w_min, mu, cov)[0]
    ret_hi = stats(w_max, mu, cov)[0]
    rows = []
    for target in np.linspace(ret_lo, ret_hi, points):
        w = min_variance(mu, cov, target)
        rows.append((stats(w, mu, cov)[1], target))
    return np.array(rows)


# ---------- 白話建議 ----------

def class_totals(weights):
    totals = {}
    for asset, w in weights.items():
        cls = ASSET_CLASS.get(asset, "其他")
        totals[cls] = totals.get(cls, 0) + w
    return totals


def plain_advice(name, weights, ret, risk):
    top = weights[weights >= 0.05].sort_values(ascending=False)
    holdings = "、".join(f"{ASSET_NAME.get(a, a)}（{a}）{w:.0%}" for a, w in top.items())
    classes = "、".join(f"{k} {v:.0%}" for k, v in sorted(class_totals(weights).items(), key=lambda x: -x[1]) if v >= 0.005)
    return (
        f"【{name}】主要持有：{holdings}。\n"
        f"  資產類別：{classes}。\n"
        f"  以過去資料估算，年化報酬約 {ret:.1%}，年化波動約 {risk:.1%}；"
        f"也就是說，帳面在一年內上下起伏約 {risk:.0%} 是常見的情況。"
    )


# ---------- 網頁資料 ----------

def write_web_data(path, assets, mu, cov, prices):
    """輸出 js/portfolio-data.js：網頁依問卷分數即時最佳化時使用的統計量。"""
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


# ---------- 圖表 ----------

def plot_frontier(path, frontier, mu, cov, results, w_min, show):
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(11, 7))
    ax.plot(frontier[:, 0], frontier[:, 1], color="#251f6b", linewidth=2.2,
            label=f"Efficient Frontier (max weight {MAX_WEIGHT:.0%})")

    single_risk = pd.Series(np.sqrt(np.diag(cov.values)), index=mu.index)
    ax.scatter(single_risk, mu, color="grey", s=35, zorder=3)
    for name in mu.index:
        ax.annotate(name, (single_risk[name], mu[name]), textcoords="offset points",
                    xytext=(5, 5), fontsize=8, color="dimgrey")

    colors = {"conservative": "#14b8a6", "moderate": "#1d2e5c", "aggressive": "#c97c13"}
    for t in RISK_TYPES:
        r = results[t["key"]]
        ax.scatter(r["risk"], r["return"], s=260, marker="*", color=colors[t["key"]],
                   edgecolor="black", zorder=5, label=f"{t['label']} (score {t['score']:.0f})")
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
    import matplotlib.pyplot as plt

    labels = [t["label"] for t in RISK_TYPES]
    fig, ax = plt.subplots(figsize=(9, 7))
    palette = plt.get_cmap("tab10").colors
    bottom = np.zeros(len(labels))
    for i, asset in enumerate(weight_table.index):
        vals = weight_table.loc[asset, [t["key"] for t in RISK_TYPES]].values.astype(float) * 100
        ax.bar(labels, vals, bottom=bottom, color=palette[i % 10], edgecolor="white", label=f"{asset} {ASSET_NAME_EN.get(asset, '')}".strip())
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


# ---------- 主程式 ----------

def main():
    parser = argparse.ArgumentParser(description="依投資人風險類型做 MPT 最適配置")
    parser.add_argument("--score", type=float, help="另外替一個 0–100 的基準風險分數（網頁問卷結果）算出配置")
    parser.add_argument("--show", action="store_true", help="執行完開啟圖表視窗")
    args = parser.parse_args()
    if args.score is not None and not 0 <= args.score <= 100:
        parser.error("--score 必須介於 0 到 100")
    if not args.show:
        matplotlib.use("Agg")

    prices, mu, cov = load_inputs()
    assets = list(mu.index)
    print(f"資料期間：{prices.index[0].date()} ~ {prices.index[-1].date()}，共 {len(prices)} 個共同交易日")
    print(f"資產：{assets}；單一資產權重上限 {MAX_WEIGHT:.0%}；無風險利率 {RISK_FREE:.1%}")

    w_min = min_variance(mu, cov)
    w_max = max_return(mu)
    anchors = (w_min, w_max)
    risk_lo, risk_hi = stats(w_min, mu, cov)[1], stats(w_max, mu, cov)[1]
    print(f"可行風險範圍：{risk_lo:.2%}（MVP）~ {risk_hi:.2%}（最大報酬組合）")

    results, tables = {}, {}
    to_run = list(RISK_TYPES)
    if args.score is not None:
        to_run.append({"key": "custom", "name": "自訂分數", "label": "Custom", "score": args.score})

    for t in to_run:
        w, target = allocation_for_score(t["score"], mu, cov, anchors)
        ret, risk, sharpe = stats(w, mu, cov)
        assert abs(w.sum() - 1) < 1e-9 and (w >= -1e-9).all() and (w <= MAX_WEIGHT + 1e-9).all()
        assert risk <= target + 1e-6, "風險超過目標"
        results[t["key"]] = {"weights": pd.Series(w, index=assets), "return": ret, "risk": risk, "sharpe": sharpe, "target": target}
        tables[t["key"]] = t

    # 比較基準
    eq = np.full(len(assets), 1 / len(assets))
    eq_ret, eq_risk, eq_sharpe = stats(eq, mu, cov)

    # 輸出表格
    weight_table = pd.DataFrame({k: r["weights"] for k, r in results.items()})
    summary = pd.DataFrame(
        {k: {"Risk Score": tables[k]["score"], "Target Volatility": r["target"], "Expected Return": r["return"],
             "Volatility": r["risk"], "Sharpe Ratio": r["sharpe"]} for k, r in results.items()}
    )
    out = pd.concat([weight_table, summary])
    out.to_csv(HERE / "allocation_by_risk_type.csv", encoding="utf-8-sig")

    pd.set_option("display.width", 200)
    print("\n=== 各風險類型的最適配置（權重）===")
    print(weight_table.map(lambda x: f"{x:.1%}").to_string())
    print("\n=== 風險報酬比較 ===")
    print(summary.round(4).to_string())
    print(f"\n（等權重基準：報酬 {eq_ret:.2%}，風險 {eq_risk:.2%}，夏普 {eq_sharpe:.2f}）")

    lines = []
    for k, r in results.items():
        lines.append(plain_advice(tables[k]["name"] + f"（分數 {tables[k]['score']:.0f}）", r["weights"], r["return"], r["risk"]))
    advice = "\n\n".join(lines) + (
        "\n\n注意：預期報酬使用過去的歷史平均，不代表未來表現；以上為教學用的模型結果，不是個人化投資建議。"
    )
    print("\n=== 白話建議 ===")
    print(advice)
    (HERE / "allocation_summary.txt").write_text(advice + "\n", encoding="utf-8")

    write_web_data(HERE.parent / "js" / "portfolio-data.js", assets, mu, cov, prices)

    frontier = efficient_frontier(mu, cov, w_min, w_max)
    plot_frontier(HERE / "efficient_frontier_by_type.png", frontier, mu, cov, results, w_min, args.show)
    plot_allocation(HERE / "allocation_comparison.png", weight_table, args.show)
    print("\n[檔案輸出] allocation_by_risk_type.csv、allocation_summary.txt、efficient_frontier_by_type.png、allocation_comparison.png")

    if args.show:
        import matplotlib.pyplot as plt
        plt.show()


if __name__ == "__main__":
    main()
