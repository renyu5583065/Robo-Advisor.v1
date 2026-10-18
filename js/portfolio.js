/**
 * portfolio.js
 * 
 * 【功能說明】
 * 現代投資組合理論（MPT - Modern Portfolio Theory）瀏覽器端最佳化引擎：
 * 依據問卷測出的「基準風險分數（0–100）」，在瀏覽器前端即時運算出最適資產配置比例。
 * 
 * 【數學原理與目標】
 * 1. 線性對應目標風險：
 *    目標風險 = 最小風險 + (分數 / 100) × (最大風險 − 最小風險)
 * 2. 最佳化限制條件：
 *    - 不放空（各資產權重 >= 0）
 *    - 單一資產配置上限（各資產權重 <= maxWeight，例如 40%）
 *    - 資金完全配置（所有權重總和 = 1）
 *    - 在投資組合風險不超過目標風險的前提下，最大化投資組合的預期年化報酬率。
 * 3. 演算法實作：
 *    不依賴外部龐大套件，純手工以 JavaScript 實作：
 *    - 內層：採用加速投影梯度法（FISTA）求解特定風險懲罰係數 λ 下的拉格朗日最佳化權重。
 *    - 外層：對懲罰係數 λ 進行對數尺度二分搜尋，精確找出風險等於目標風險的資產權重配置。
 */

// 確保全域命名空間物件 RoboAdvisor 存在（若尚未建立則初始化為空物件）
window.RoboAdvisor = window.RoboAdvisor || {};

// 使用 IIFE（立即執行函式）模組化封裝，回傳 optimize 方法供外部調用
RoboAdvisor.portfolio = (function () {
  // 1. 常數定義 (Constants)
  const EPS = 1e-6; // 數值微小誤差門檻值，權重小於此值視為 0，避免浮點數微小殘差影響顯示

  // 2. 向量與矩陣基本運算 (Vector & Matrix Math)

  /**
   * 計算二次型 (Quadratic Form)：wᵀ · Cov · w
   * 物理意義：計算投資組合的「變異數（Variance）」，將變異數開根號即為「年化波動度（風險）」
   * @param {Array<number>} w - 各資產權重向量
   * @param {Array<Array<number>>} cov - 資產之間的共變異數矩陣
   * @returns {number} 投資組合變異數
   */
  function quad(w, cov) {
    let s = 0;
    for (let i = 0; i < w.length; i += 1) {
      for (let j = 0; j < w.length; j += 1) {
        s += w[i] * cov[i][j] * w[j];
      }
    }
    return s;
  }

  /**
   * 計算兩個一維向量的內積 (Dot Product)：a · b = Σ (a[i] * b[i])
   * 物理意義：例如計算投資組合預期報酬率 = 各資產權重 w · 各資產預期報酬率 mu
   * @param {Array<number>} a - 向量 a
   * @param {Array<number>} b - 向量 b
   * @returns {number} 內積純量結果
   */
  function dot(a, b) {
    return a.reduce((s, x, i) => s + x * b[i], 0);
  }

  // 3. 投影運算與凸優化求解器 (Projection & Optimization)

  /**
   * 歐氏投影運算：將無約束的權重向量 v 投影回滿足約束條件的集合：
   * 約束條件：{ 0 ≤ w[i] ≤ cap, 且所有 w[i] 總和 = 1 }
   * 數學原理：w[i] = clip(v[i] - tau, 0, cap)，並利用二分搜尋法找出剛好使總和為 1 的位移值 tau
   * @param {Array<number>} v - 待投影的向量
   * @param {number} cap - 單一資產持股上限比例（例如 0.4）
   * @returns {Array<number>} 投影後合法的新權重向量
   */
  function project(v, cap) {
    let lo = Math.min(...v) - cap;
    let hi = Math.max(...v);
    // 二分搜尋進行 100 次迭代，逼近精確的位移常數 tau
    for (let k = 0; k < 100; k += 1) {
      const tau = (lo + hi) / 2;
      const sum = v.reduce((s, x) => s + Math.min(cap, Math.max(0, x - tau)), 0);
      if (sum > 1) lo = tau;
      else hi = tau;
    }
    const tau = (lo + hi) / 2;
    return v.map((x) => Math.min(cap, Math.max(0, x - tau)));
  }

  /**
   * 求解拉格朗日目標函數的最大值：max (μ·w − λ·wᵀΣw)
   * 物理意義：在給定風險懲罰係數 lambda 下，權衡「爭取報酬 μ·w」與「懲罰風險 λ·wᵀΣw」
   * 採用 FISTA（加速投影梯度下降法，Nesterov 加速技術）快速收斂至全域最佳解
   * @param {Array<number>} mu - 各資產預期報酬率向量
   * @param {Array<Array<number>>} cov - 共變異數矩陣
   * @param {number} lambda - 風險懲罰係數（lambda 越大代表對風險懲罰越重，偏好更低風險）
   * @param {number} cap - 單一資產權重上限
   * @param {Array<number>} start - 初始迭代權重向量
   * @returns {Array<number>} 最佳化後的資產權重向量
   */
  function solveLagrangian(mu, cov, lambda, cap, start) {
    const n = mu.length;
    // 計算梯度的 Lipschitz 常數上界 L，作為梯度下降的學習步伐依據
    const L = Math.max(2 * lambda * Math.max(...cov.map((row) => row.reduce((s, x) => s + Math.abs(x), 0))), 1e-9);
    let w = start.slice();
    let y = w.slice();
    let t = 1;
    for (let iter = 0; iter < 4000; iter += 1) {
      // 計算當前點的梯度方向：grad = mu - 2 * lambda * (Cov * y)
      const grad = y.map((_, i) => mu[i] - 2 * lambda * dot(cov[i], y));
      // 沿梯度前進一步並投影回合法約束空間中
      const next = project(y.map((x, i) => x + grad[i] / L), cap);
      // Nesterov 加速動量更新公式
      const tNext = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
      y = next.map((x, i) => x + ((t - 1) / tNext) * (x - w[i]));
      // 計算本次迭代權重的變動幅度
      const move = next.reduce((s, x, i) => s + Math.abs(x - w[i]), 0);
      w = next;
      t = tNext;
      // 若前後兩步變動微乎其微且已迭代一定次數，代表已收斂，提早跳出迴圈
      if (move < 1e-13 && iter > 20) break;
    }
    return w;
  }

  // 4. 極端端點投資組合計算 (Boundary Portfolios)

  /**
   * 計算「最小變異數投資組合（風險最低組合）」
   * 對應風險分數 0 分時的極致防禦型配置
   * @param {Array<Array<number>>} cov - 共變異數矩陣
   * @param {number} cap - 單一資產權重上限
   * @returns {Array<number>} 最小風險時的資產權重
   */
  function minVariance(cov, cap) {
    const n = cov.length;
    const zero = new Array(n).fill(0); // 將預期報酬率設為 0，完全只追求最小化風險變異數
    return solveLagrangian(zero, cov, 1, cap, new Array(n).fill(1 / n));
  }

  /**
   * 計算「最大報酬投資組合（報酬最高組合）」
   * 對應風險分數 100 分時的極致積極型配置
   * 原理：貪婪演算法（Greedy），依照預期報酬由高到低，逐一將資產權重填至上限 cap 直到總和為 1
   * @param {Array<number>} mu - 各資產預期報酬率向量
   * @param {number} cap - 單一資產權重上限
   * @returns {Array<number>} 最大報酬時的資產權重
   */
  function maxReturn(mu, cap) {
    const w = new Array(mu.length).fill(0);
    let left = 1; // 尚可分配的剩餘總資金比例
    mu
      .map((m, i) => [m, i])
      .sort((a, b) => b[0] - a[0]) // 依報酬由大到小排序
      .forEach(([, i]) => {
        const x = Math.min(cap, left); // 能分多少就盡量填到上限
        w[i] = x;
        left -= x;
      });
    return w;
  }

  // 5. 數據清洗與績效指標計算 (Data Cleaning & Statistics)

  /**
   * 數值微小雜訊清理：將過小（小於 EPS）的微量權重強制歸零，並重新正規化使總權重百分之百等於 1
   * @param {Array<number>} w - 原始權重陣列
   * @returns {Array<number>} 清理正規化後的權重陣列
   */
  function cleanWeights(w) {
    const c = w.map((x) => (Math.abs(x) < EPS ? 0 : x));
    const s = c.reduce((a, b) => a + b, 0);
    return c.map((x) => x / s);
  }

  /**
   * 計算該投資組合的關鍵統計指標（預期年化報酬率、年化波動度風險、夏普值）
   * @param {Array<number>} w - 投資組合權重陣列
   * @param {Object} data - 歷史資產數據（包含 mu, cov, riskFree）
   * @returns {{ return: number, risk: number, sharpe: number }} 統計結果物件
   */
  function stats(w, data) {
    const ret = dot(w, data.mu);              // 預期報酬率 = w · mu
    const risk = Math.sqrt(quad(w, data.cov)); // 年化波動度 = √(wᵀ · Cov · w)
    // 夏普值 = (預期報酬率 - 無風險利率) / 年化波動度，代表每承受一單位風險所能獲得的超額報酬
    const sharpe = risk > 0 ? (ret - data.riskFree) / risk : 0;
    return { return: ret, risk, sharpe };
  }

  // 6. 主最佳化入口函式 (Main Optimize Entry)

  /**
   * 根據使用者的問卷基準風險分數（0~100）計算出最適資產配置
   * @param {number} score - 基準風險分數（0 到 100 之間）
   * @param {Object} [data] - 投資組合數據（預設取自 RoboAdvisor.portfolioData）
   * @returns {{ holdings: Array<Object>, ret: number, risk: number, sharpe: number, targetRisk: number }}
   */
  function optimize(score, data) {
    data = data || RoboAdvisor.portfolioData;
    const cap = data.maxWeight;

    // 1. 先計算兩個極端端點：最小風險組合與最大報酬組合
    const wMin = cleanWeights(minVariance(data.cov, cap));
    const wMax = cleanWeights(maxReturn(data.mu, cap));
    const riskLo = stats(wMin, data).risk; // 最低風險端點
    const riskHi = stats(wMax, data).risk; // 最高風險端點

    // 2. 將使用者的分數限制在 0~100 之間，並線性插值出個人的「目標風險」
    const clamped = Math.min(100, Math.max(0, Number(score) || 0));
    const targetRisk = riskLo + (clamped / 100) * (riskHi - riskLo);

    let w;
    // 3. 邊界判斷：若目標風險已達最大或最小邊界，直接採用端點配置
    if (targetRisk >= riskHi - 1e-12) {
      w = wMax;
    } else if (targetRisk <= riskLo + 1e-12) {
      w = wMin;
    } else {
      // 4. 中間情況：外層對懲罰係數 λ 進行對數尺度（Log Scale）二分搜尋
      // 說明：λ 越大時對風險懲罰越強烈，所得組合風險越低；反之 λ 越小所得風險越高
      let lo = 1e-4;
      let hi = 1e4;
      let best = wMin;
      for (let k = 0; k < 60; k += 1) {
        const lambda = Math.sqrt(lo * hi); // 取幾何平均數進行對數尺度的中點搜尋
        const cand = solveLagrangian(data.mu, data.cov, lambda, cap, best);
        const risk = Math.sqrt(quad(cand, data.cov));
        if (risk > targetRisk) {
          lo = lambda; // 當前風險太高，需要調大懲罰係數 lambda
        } else {
          hi = lambda; // 當前風險太低，調小懲罰係數 lambda
          best = cand;
        }
        // 若風險已非常接近目標風險（誤差小於 1e-9），提前結束搜尋
        if (Math.abs(risk - targetRisk) < 1e-9) break;
      }
      w = best;
    }

    // 5. 清理權重並計算最終資產組合統計數值
    w = cleanWeights(w);
    const s = stats(w, data);

    // 6. 整理持股清單：過濾掉權重為 0 的資產，並依照持股比重由大到小排序
    const holdings = data.assets
      .map((a, i) => ({ code: a.code, name: a.name, assetClass: a.assetClass, weight: w[i] }))
      .filter((h) => h.weight > 0)
      .sort((a, b) => b.weight - a.weight);

    return {
      holdings,           // 推薦持股明細
      ret: s.return,      // 預期年化報酬率
      risk: s.risk,       // 年化波動度（風險）
      sharpe: s.sharpe,   // 夏普值
      targetRisk,         // 本次計算對齊的目標風險
    };
  }

  // 7. 匯出公開介面 (Public API)
  return { optimize };
})();
