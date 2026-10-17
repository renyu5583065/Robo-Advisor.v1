import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import scipy.optimize as solver

# 1. 讀取資料並計算報酬率
df = pd.read_csv('portfolio/clean_prices.csv', index_col=0, parse_dates=True)

total_stocks = len(df.columns)
returns = df.pct_change().dropna()

covariance_matrix = returns.cov() * 252             # 年化共變異數矩陣
stocks_expected_return = returns.mean() * 252       # 年化期望報酬率

print('資產:', list(df.columns))
print('報酬率樣本數:', len(returns))

# 2. 等權重投資組合（作為比較基準）
equal_weights = np.array([1 / total_stocks] * total_stocks)
equal_return = np.sum(equal_weights * stocks_expected_return)
equal_risk = np.sqrt(equal_weights @ covariance_matrix @ equal_weights)

print('\n【等權重投資組合】')
print('預期報酬率為:', round(equal_return, 4))
print('風險為:', round(equal_risk, 4))

# 3. 投資組合機會集合（隨機模擬）
np.random.seed(42)
simulations_target = 50000

weights = np.random.rand(simulations_target, total_stocks)
weights = weights / weights.sum(axis=1, keepdims=True)      # 每組權重總和 = 1

return_list = weights @ stocks_expected_return
risk_list = np.sqrt(np.sum((weights @ covariance_matrix) * weights, axis=1))

print('\n【機會集合】共模擬', simulations_target, '組投資組合')
print('報酬率範圍:', round(return_list.min(), 4), '~', round(return_list.max(), 4))
print('風險範圍:', round(risk_list.min(), 4), '~', round(risk_list.max(), 4))

# 4. 最小變異數投資組合 (MVP)
def standard_deviation(w):
    return np.sqrt(w @ covariance_matrix @ w)       

x0 = equal_weights
bounds = tuple((0, 1) for _ in range(total_stocks))          # 不允許放空
constraints = [{'type': 'eq', 'fun': lambda x: sum(x) - 1}]  # 權重總和 = 1

minimize_variance = solver.minimize(standard_deviation, x0=x0,
                                    constraints=constraints, bounds=bounds)

mvp_weights = minimize_variance.x
mvp_risk = minimize_variance.fun
mvp_return = np.sum(mvp_weights * stocks_expected_return)

print('\n【最小變異數投資組合 MVP】')
print('預期報酬率為:', round(mvp_return, 4))
print('風險為:', round(mvp_risk, 4))
for i in range(total_stocks):
    print(f'{df.columns[i]} 佔投資組合權重 : {mvp_weights[i]:.4f}')

# 分散效果：與單一資產的風險比較
single_risk = pd.Series(np.sqrt(np.diag(covariance_matrix)), index=df.columns)
print('\n【分散效果】')
print('MVP 風險:', round(mvp_risk, 4))
print('風險最低的單一資產:', single_risk.idxmin(), round(single_risk.min(), 4))
print('單一資產平均風險:', round(single_risk.mean(), 4))

# 5. 效率前緣
efficient_frontier_return_range = np.linspace(mvp_return, stocks_expected_return.max(), 50)
efficient_frontier_risk_list = []

for target in efficient_frontier_return_range:
    constraints = [{'type': 'eq', 'fun': lambda x: sum(x) - 1},
                   {'type': 'eq', 'fun': lambda x: sum(x * stocks_expected_return) - target}]
    result = solver.minimize(standard_deviation, x0=x0,
                             constraints=constraints, bounds=bounds)
    efficient_frontier_risk_list.append(result.fun)

# 6. 繪圖
risk_free = 0.02

fig = plt.figure(figsize=(12, 7))
ax = fig.add_subplot()

sc = ax.scatter(risk_list, return_list,
                c=(return_list - risk_free) / risk_list,
                marker='o', s=5, alpha=0.6)
ax.plot(efficient_frontier_risk_list, efficient_frontier_return_range,
        linewidth=2, color='#251f6b', label='Efficient Frontier')
ax.plot(mvp_risk, mvp_return, '*', color='r', markersize=25,
        markeredgecolor='black', label='MVP')

# 標示各單一資產
ax.scatter(single_risk, stocks_expected_return, color='black', s=40, zorder=5)
for name in df.columns:
    ax.annotate(name, (single_risk[name], stocks_expected_return[name]),
                textcoords='offset points', xytext=(5, 5), fontsize=9)

ax.spines['right'].set_visible(False)
ax.spines['top'].set_visible(False)
ax.set_title('Portfolio Opportunity Set and Efficient Frontier', fontsize=18, fontweight='bold')
ax.set_xlabel('Risk (Annualized Volatility)')
ax.set_ylabel('Return (Annualized)')
ax.legend()
fig.colorbar(sc, ax=ax, label='Sharpe Ratio')
plt.savefig('Efficient_Frontier.png', dpi=300)

# MVP 權重長條圖
fig2 = plt.figure(figsize=(8, 5))
ax2 = fig2.add_subplot()
ax2.bar(df.columns, mvp_weights * 100, color='steelblue')
for i, w in enumerate(mvp_weights):
    ax2.text(i, w * 100 + 0.5, f'{w:.1%}', ha='center')
ax2.set_title('MVP Weights', fontsize=16, fontweight='bold')
ax2.set_ylabel('Weight (%)')
plt.savefig('MVP_Weights.png', dpi=300)

plt.show()