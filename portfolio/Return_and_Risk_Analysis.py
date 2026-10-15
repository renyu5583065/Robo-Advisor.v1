import glob
import os
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

DATA_FOLDER = "."       # 存放 CSV 的資料夾路徑，"." 代表當前目錄
TRADING_DAYS = 252      # 年化交易日數
MAX_FFILL_DAYS = 5      # 缺漏值最多向前填補天數
OUTPUT_DIR = "."        # 輸出 CSV 與圖片的目錄

EXPORT_TO_CSV = True   # 是否輸出各項分析 CSV 檔 (True / False)
EXPORT_PLOTS = True    # 是否輸出圖表 PNG 檔 (True / False)

plt.rcParams["axes.unicode_minus"] = False


# Part I. 資料讀取與合併
def load_and_merge_csvs(folder_path: str) -> pd.DataFrame:
    """自動尋找資料夾內的所有 CSV 檔，擷取收盤價並合併成一張寬表格"""
    csv_files = glob.glob(os.path.join(folder_path, "*.csv"))

    # 忽略預設產生的輸出檔，避免重複讀取
    ignore_files = {
        "clean_prices.csv",
        "return_matrix.csv",
        "risk_return_table.csv",
        "correlation_matrix.csv",
        "covariance_daily.csv",
        "covariance_annual.csv",
    }
    csv_files = [f for f in csv_files if os.path.basename(f) not in ignore_files]

    if not csv_files:
        raise FileNotFoundError(f"在 '{folder_path}' 中找不到任何資產的 CSV 檔案！")

    print(f"找到 {len(csv_files)} 個 CSV 檔案，開始自動讀取與合併：")

    merged_series = {}

    for file_path in csv_files:
        file_name = os.path.basename(file_path)
        # 取得資產名稱
        asset_name = (
            file_name.replace(".csv", "")
            .replace("歷史資料", "")
            .replace("歷史數據", "")
        )

        try:
            df = pd.read_csv(file_path, encoding="utf-8-sig", thousands=",")
        except Exception:
            df = pd.read_csv(file_path, encoding="big5", thousands=",")

        # 指定日期和收盤價欄位名稱
        date_col = "日期"
        close_col = "收市"

        # 整理日期與價格
        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")#無法識別，轉換成NaT
        df = df.dropna(subset=[date_col]) #刪除有NaT的列
        df = df.sort_values(by=date_col) #按日期排序
        df = df.drop_duplicates(subset=[date_col], keep="last") #若有重複日期，保留最後一筆

        price_series = pd.to_numeric(
            df[close_col].astype(str).str.replace(",", ""), errors="coerce"
        )#將收盤價轉換成數字，若無法轉換成數字，轉換成NaN
        price_series.index = df[date_col] #將日期設為索引
        price_series.name = asset_name #將資產名稱設為Series名稱

        merged_series[asset_name] = price_series #將資產加入合併 Series
        print(f"  - 資產 [{asset_name}]：採用欄位 '{close_col}'")

    prices = pd.DataFrame(merged_series)
    prices.index.name = "Date"
    prices = prices.sort_index()

    return prices


def clean_prices(df):
    print("\n=== 缺漏值檢查（處理前）===")
    print(df.isna().sum().to_string())
    before = len(df)
    df = df.dropna(how="any")   # 只保留 8 檔皆有資料的日期
    print(f"\n刪除的非共同交易日列數：{before - len(df)}")

    print("\n=== 缺漏值檢查（處理後）===")
    print(df.isna().sum().to_string())
    return df


def compute_returns(prices: pd.DataFrame) -> pd.DataFrame:
    """計算簡單日報酬率"""
    return prices.pct_change().dropna()


# Part II. 風險報酬分析
def risk_return_table(returns: pd.DataFrame) -> pd.DataFrame:
    """計算平均報酬率、年化報酬率與波動度"""
    avg_daily = returns.mean()
    std_daily = returns.std()

    table = pd.DataFrame(
        {
            "Average Daily Return": avg_daily,
            "Annualized Return (Arithmetic)": avg_daily * TRADING_DAYS,
            "Annualized Return (Geometric)": (1 + returns).prod()
            ** (TRADING_DAYS / len(returns))
            - 1,
            "Daily Std Dev": std_daily,
            "Annualized Volatility": std_daily * np.sqrt(TRADING_DAYS),
        }
    ) #將平均報酬率、年化報酬率與波動度存入DataFrame
    table["Return/Risk (Arithmetic)"] = (
        table["Annualized Return (Arithmetic)"] / table["Annualized Volatility"]
    ) #計算夏普比率
    return table


def top_bottom_pairs(corr: pd.DataFrame, n: int = 5):
    """取出相關性最高與最低的資產配對"""
    if corr.shape[1] < 2: #shape[1]: 欄數，資產數量小於2，沒有pair可以配對
        return pd.Series(dtype=float), pd.Series(dtype=float) 

    pairs = corr.where(np.triu(np.ones(corr.shape), k=1).astype(bool)).stack() #triu: 上三角矩陣，k=1表示不包含對角線，避免重複計算
    pairs.name = "Correlation"
    pairs = pairs.sort_values(ascending=False)
    return pairs.head(n), pairs.tail(n).sort_values() #取得相關性最高/低的前n筆


def plot_heatmap(corr: pd.DataFrame, path: str):
    """相關係數熱力圖"""
    if corr.shape[1] < 2:
        return
    fig, ax = plt.subplots(figsize=(8, 6.5))
    im = ax.imshow(corr.values, cmap="RdYlGn_r", vmin=-1, vmax=1)
    ax.set_xticks(range(len(corr)))
    ax.set_yticks(range(len(corr)))
    ax.set_xticklabels(corr.columns, rotation=45, ha="right")
    ax.set_yticklabels(corr.index)
    for i in range(len(corr)):
        for j in range(len(corr)):
            ax.text(
                j,
                i,
                f"{corr.values[i, j]:.2f}",
                ha="center",
                va="center",
                fontsize=9,
            )
    fig.colorbar(im, ax=ax, label="Correlation")
    ax.set_title("Correlation Matrix of Daily Returns")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def plot_risk_return(table: pd.DataFrame, path: str):
    """風險報酬散佈圖"""
    fig, ax = plt.subplots(figsize=(8, 6))
    x = table["Annualized Volatility"]
    y = table["Annualized Return (Arithmetic)"]
    ax.scatter(x, y, s=80)
    for name in table.index:
        ax.annotate(
            name, (x[name], y[name]), textcoords="offset points", xytext=(6, 6)
        )
    ax.set_xlabel("Annualized Volatility")
    ax.set_ylabel("Annualized Return")
    ax.set_title("Risk vs. Return of Individual Assets")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


# 主程式
def main():
    # 1. 讀取並清洗資料
    prices = load_and_merge_csvs(DATA_FOLDER)
    prices = clean_prices(prices)

    years = (prices.index[-1] - prices.index[0]).days / 365.25 #包含閏年平均
    print("\n" + "=" * 50)
    print(f"資產數量：{prices.shape[1]} 檔 -> {list(prices.columns)}")
    print(f"資料期間：{prices.index[0].date()} ~ {prices.index[-1].date()}（約 {years:.1f} 年）")
    print(f"有效共同交易日數：{len(prices)} 天")
    print("=" * 50)

    returns = compute_returns(prices)

    print("\n=== 日報酬率矩陣 (Return Matrix) 前 5 筆 ===")
    print(returns.head().round(5).to_string())

    # 2. 數據計算
    table = risk_return_table(returns)
    corr = returns.corr()
    cov_daily = returns.cov()
    cov_annual = cov_daily * TRADING_DAYS

    pd.set_option("display.width", 200)

    print("\n=== 各資產年化報酬與風險 ===")
    print(table.round(4).to_string())

    print("\n=== 相關係數矩陣 (Correlation Matrix) ===")
    print(corr.round(3).to_string())

    print("\n=== 每日共變異數矩陣 (Daily Covariance Matrix) ===")
    print(cov_daily.round(8).to_string())

    print("\n=== 年化共變異數矩陣 (Annualized Covariance Matrix) ===")
    print(cov_annual.round(5).to_string())

    top, bottom = top_bottom_pairs(corr)
    print("\n=== Q1：相關性最高的前 5 對資產 ===")
    print(top.round(3).to_string())

    print("\n=== Q2：相關性最低（或負相關）的前 5 對資產 ===")
    print(bottom.round(3).to_string())

    avg_corr = (corr.sum() - 1) / (corr.shape[0] - 1) #
    avg_corr = avg_corr.sort_values()
    print("\n=== Q3：各資產與其他資產的平均相關係數（由低到高）===")
    print(avg_corr.round(3).to_string())

    # 3. 檔案匯出控制（目前預設 False，不產生任何實體檔案）
    if EXPORT_TO_CSV:
        prices.to_csv(f"{OUTPUT_DIR}/clean_prices.csv")
        returns.to_csv(f"{OUTPUT_DIR}/return_matrix.csv")
        table.to_csv(f"{OUTPUT_DIR}/risk_return_table.csv")
        corr.to_csv(f"{OUTPUT_DIR}/correlation_matrix.csv")
        cov_daily.to_csv(f"{OUTPUT_DIR}/covariance_daily.csv")
        cov_annual.to_csv(f"{OUTPUT_DIR}/covariance_annual.csv")
        print("\n[檔案輸出] 已儲存所有分析 CSV 檔案。")
    else:
        print("\n[提示] 目前未輸出 CSV 檔")

    if EXPORT_PLOTS:
        plot_heatmap(corr, f"{OUTPUT_DIR}/correlation_heatmap.png")
        plot_risk_return(table, f"{OUTPUT_DIR}/risk_return_scatter.png")
        print("[檔案輸出] 已產生圖表 PNG 檔案。")
    else:
        print("[提示] 目前未輸出圖表")


if __name__ == "__main__":
    main()

