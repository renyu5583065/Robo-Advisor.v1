"""
MPT_Opportunity_Set_MVP.py

【功能說明】
現代投資組合理論實作範例：
1. 資料前處理：讀取各資產歷史股價，計算日報酬率，並年化為期望報酬率與共變異數矩陣。
2. 基準組合：計算等權重配置的預期報酬與風險。
3. 蒙地卡羅模擬：隨機生成 50,000 組不同權重組合，繪製出「投資組合機會集合」。
4. 凸優化求解：求得全域風險最低的「最小變異數投資組合（MVP）」，驗證分散風險效果。
5. 效率前緣：在不同預期報酬目標下，找出風險最小的最佳配置曲線。
6. 視覺化：使用 Matplotlib 繪製投資機會集合散點圖、效率前緣曲線與 MVP 資產權重長條圖。
"""

# 載入科學計算與資料處理必備套件
import numpy as np               # 支援矩陣運算與高維度數值計算
import pandas as pd              # 支援表格資料處理與時間序列運算
import matplotlib.pyplot as plt  # 支援繪圖與圖表視覺化
import scipy.optimize as solver  # 支援數學規劃與數值最佳化求解器

# 1. 讀取價格資料並計算年化統計量
# 讀取 CSV 檔案，將第 0 欄設為時間索引 (index_col=0)，並解析為日期時間格式 (parse_dates=True)
df = pd.read_csv('portfolio/clean_prices.csv', index_col=0, parse_dates=True)

# 計算總資產檔數（欄位數量）
total_stocks = len(df.columns)

# 計算日報酬率：pct_change() 計算當日相對前一日的漲跌幅比例；dropna() 移除第一筆無法計算的空值 (NaN)
returns = df.pct_change().dropna()

# 金融常識：一年約有 252 個交易日
# 年化共變異數矩陣：日共變異數 × 252（衡量不同資產間同向或反向變動的相關程度與波動度）
covariance_matrix = returns.cov() * 252
# 年化期望報酬率：平均日報酬率 × 252
stocks_expected_return = returns.mean() * 252

print('資產:', list(df.columns))
print('報酬率樣本數:', len(returns))

# 2. 等權重投資組合（作為比較基準 Benchmark）
# 1/N 策略：資金平分給每一檔資產，每檔權重均為 1 / total_stocks
equal_weights = np.array([1 / total_stocks] * total_stocks)
# 組合預期報酬率 = 各資產權重 與 預期報酬率的加權點積總和
equal_return = np.sum(equal_weights * stocks_expected_return)
# 組合年化波動度（風險）= √(wᵀ · Cov · w)
# 說明：在 Python 3.5+ 中，@ 運算符號代表矩陣相乘（Matrix Multiplication）
equal_risk = np.sqrt(equal_weights @ covariance_matrix @ equal_weights)

print('\n【等權重投資組合】')
print('預期報酬率為:', round(equal_return, 4))
print('風險為:', round(equal_risk, 4))

# 3. 蒙地卡羅隨機模擬：生成投資組合機會集合（Opportunity Set）
np.random.seed(42)           # 設定隨機種子，確保每次執行程式時產生的隨機數值完全一致
simulations_target = 50000   # 模擬生成 50,000 組不同的投資組合權重

# 隨機產生 50,000 列、total_stocks 欄介於 0~1 之間的均勻分佈隨機數
weights = np.random.rand(simulations_target, total_stocks)
# 權重歸一化：每一列（每組投資組合）的權重相加必須剛好等於 1 (100% 資金完全配置)
weights = weights / weights.sum(axis=1, keepdims=True)

# 矩陣相乘批次計算 50,000 組組合的年化預期報酬率 (50000,)
return_list = weights @ stocks_expected_return
# 批次計算 50,000 組組合的年化波動度 (50000,)：√(w · Cov · wᵀ)
risk_list = np.sqrt(np.sum((weights @ covariance_matrix) * weights, axis=1))

print('\n【機會集合】共模擬', simulations_target, '組投資組合')
print('報酬率範圍:', round(return_list.min(), 4), '~', round(return_list.max(), 4))
print('風險範圍:', round(risk_list.min(), 4), '~', round(risk_list.max(), 4))

# 4. 數值最佳化求解：最小變異數投資組合 (MVP, Minimum Variance Portfolio)
def standard_deviation(w):
    """
    目標函數：計算給定權重向量 w 時的投資組合標準差（年化波動度）
    求解器的目標是透過調整 w，使此函式回傳值最小化
    """
    return np.sqrt(w @ covariance_matrix @ w)

x0 = equal_weights # 設定初始猜測值（使用等權重作為起點）
# 設定邊界約束 (bounds)：每檔資產權重介於 0 到 1 之間（0 <= w[i] <= 1，不允許放空賣空）
bounds = tuple((0, 1) for _ in range(total_stocks))
# 設定等式約束 (constraints)：所有資產權重總和扣掉 1 必須等於 0 (Σw - 1 = 0)
constraints = [{'type': 'eq', 'fun': lambda x: sum(x) - 1}]

# 呼叫 SciPy 的 SLSQP 數值最佳化演算法進行求解
minimize_variance = solver.minimize(
    standard_deviation,
    x0=x0,
    constraints=constraints,
    bounds=bounds
)

# 取得最佳化後的權重與最小風險值
mvp_weights = minimize_variance.x
mvp_risk = minimize_variance.fun
mvp_return = np.sum(mvp_weights * stocks_expected_return)

print('\n【最小變異數投資組合 MVP】')
print('預期報酬率為:', round(mvp_return, 4))
print('風險為:', round(mvp_risk, 4))
for i in range(total_stocks):
    print(f'{df.columns[i]} 佔投資組合權重 : {mvp_weights[i]:.4f}')

# 分散效果分析：與單一資產的風險進行比較
# 共變異數矩陣對角線元素（np.diag）即為各單一資產的變異數，開根號為各資產個別波動度
single_risk = pd.Series(np.sqrt(np.diag(covariance_matrix)), index=df.columns)
print('\n【分散效果】')
print('MVP 風險:', round(mvp_risk, 4))
print('風險最低的單一資產:', single_risk.idxmin(), round(single_risk.min(), 4))
print('單一資產平均風險:', round(single_risk.mean(), 4))

# 5. 繪製效率前緣（Efficient Frontier）
# 在「MVP 預期報酬」與「所有資產中最高預期報酬」之間，均勻切割出 50 個不同的目標報酬率
efficient_frontier_return_range = np.linspace(mvp_return, stocks_expected_return.max(), 50)
efficient_frontier_risk_list = []

# 針對每一個目標報酬率，求解在達到該報酬率的前提下，風險最小的配置比例
for target in efficient_frontier_return_range:
    # 增加第二個等式約束：組合報酬率必須剛好等於目標報酬 (Σ(w * r) - target = 0)
    constraints = [
        {'type': 'eq', 'fun': lambda x: sum(x) - 1},
        {'type': 'eq', 'fun': lambda x: sum(x * stocks_expected_return) - target}
    ]
    result = solver.minimize(
        standard_deviation,
        x0=x0,
        constraints=constraints,
        bounds=bounds
    )
    efficient_frontier_risk_list.append(result.fun)

# 6. 視覺化繪圖與儲存輸出
risk_free = 0.02 # 設定無風險利率（例如 2% 定存或美國短期國債利率）

fig = plt.figure(figsize=(12, 7))
ax = fig.add_subplot()

# 繪製 50,000 組隨機投資組合點雲（顏色代表夏普值 Sharpe Ratio = (報酬率 - 無風險利率) / 風險）
sc = ax.scatter(
    risk_list,
    return_list,
    c=(return_list - risk_free) / risk_list, # 顏色深度代表夏普值
    marker='o',
    s=5,
    alpha=0.6
)

# 繪製效率前緣曲線（深藍色實線）
ax.plot(
    efficient_frontier_risk_list,
    efficient_frontier_return_range,
    linewidth=2,
    color='#251f6b',
    label='Efficient Frontier'
)

# 標記最小變異數投資組合 (MVP) 為紅色大星號
ax.plot(
    mvp_risk,
    mvp_return,
    '*',
    color='r',
    markersize=25,
    markeredgecolor='black',
    label='MVP'
)

# 在圖中單獨標示出各單一資產點與名稱文字
ax.scatter(single_risk, stocks_expected_return, color='black', s=40, zorder=5)
for name in df.columns:
    ax.annotate(
        name,
        (single_risk[name], stocks_expected_return[name]),
        textcoords='offset points',
        xytext=(5, 5),
        fontsize=9
    )

# 圖表樣式美化：隱藏上方與右方外邊框
ax.spines['right'].set_visible(False)
ax.spines['top'].set_visible(False)
ax.set_title('Portfolio Opportunity Set and Efficient Frontier', fontsize=18, fontweight='bold')
ax.set_xlabel('Risk (Annualized Volatility)')
ax.set_ylabel('Return (Annualized)')
ax.legend()
fig.colorbar(sc, ax=ax, label='Sharpe Ratio')
plt.savefig('Efficient_Frontier.png', dpi=300) # 儲存高解析度圖檔 (300 DPI)

# 繪製 MVP 權重長條圖
fig2 = plt.figure(figsize=(8, 5))
ax2 = fig2.add_subplot()
ax2.bar(df.columns, mvp_weights * 100, color='steelblue')
# 在長條圖上方標註百分比文字
for i, w in enumerate(mvp_weights):
    ax2.text(i, w * 100 + 0.5, f'{w:.1%}', ha='center')
ax2.set_title('MVP Weights', fontsize=16, fontweight='bold')
ax2.set_ylabel('Weight (%)')
plt.savefig('MVP_Weights.png', dpi=300)

plt.show() # 顯示圖表視窗