/**
 * portfolio.js
 * 依問卷的基準風險分數（0–100）在瀏覽器裡即時算出最適投資組合，
 * 邏輯與 portfolio/Risk_Based_Allocation.py 相同：
 *   目標風險 = 最小風險 + (分數 / 100) × (最大風險 − 最小風險)
 *   在「風險不超過目標風險、單一資產不超過權重上限、不放空」下最大化預期報酬。
 *
 * 統計量（預期報酬、共變異數）由 Python 輸出到 portfolio-data.js。
 * 最佳化不用外部套件：把「風險上限」改寫成拉格朗日形式
 *   max  μ·w − λ·wᵀΣw   （w 在 0 ≤ w ≤ 上限、總和 = 1 的集合內）
 * 內層用加速投影梯度法解，外層對 λ 做二分搜尋，讓風險剛好等於目標。
 */

window.RoboAdvisor = window.RoboAdvisor || {};

RoboAdvisor.portfolio = (function () {
  const EPS = 1e-6;

  function quad(w, cov) {
    let s = 0;
    for (let i = 0; i < w.length; i += 1) {
      for (let j = 0; j < w.length; j += 1) s += w[i] * cov[i][j] * w[j];
    }
    return s;
  }

  function dot(a, b) {
    return a.reduce((s, x, i) => s + x * b[i], 0);
  }

  /** 投影到 {0 ≤ w ≤ cap, Σw = 1}：w = clip(v − τ)，對 τ 二分搜尋。 */
  function project(v, cap) {
    let lo = Math.min(...v) - cap;
    let hi = Math.max(...v);
    for (let k = 0; k < 100; k += 1) {
      const tau = (lo + hi) / 2;
      const sum = v.reduce((s, x) => s + Math.min(cap, Math.max(0, x - tau)), 0);
      if (sum > 1) lo = tau;
      else hi = tau;
    }
    const tau = (lo + hi) / 2;
    return v.map((x) => Math.min(cap, Math.max(0, x - tau)));
  }

  /** 最大化 μ·w − λ·wᵀΣw（凹函數），回傳權重。 */
  function solveLagrangian(mu, cov, lambda, cap, start) {
    const n = mu.length;
    // 梯度的 Lipschitz 常數上界：2λ × (Σ 的列絕對值和最大值)
    const L = Math.max(2 * lambda * Math.max(...cov.map((row) => row.reduce((s, x) => s + Math.abs(x), 0))), 1e-9);
    let w = start.slice();
    let y = w.slice();
    let t = 1;
    for (let iter = 0; iter < 4000; iter += 1) {
      const grad = y.map((_, i) => mu[i] - 2 * lambda * dot(cov[i], y));
      const next = project(y.map((x, i) => x + grad[i] / L), cap);
      const tNext = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
      y = next.map((x, i) => x + ((t - 1) / tNext) * (x - w[i]));
      const move = next.reduce((s, x, i) => s + Math.abs(x - w[i]), 0);
      w = next;
      t = tNext;
      if (move < 1e-13 && iter > 20) break;
    }
    return w;
  }

  /** 風險最低的組合（λ 趨近無限大，只剩變異數）。 */
  function minVariance(cov, cap) {
    const n = cov.length;
    const zero = new Array(n).fill(0);
    return solveLagrangian(zero, cov, 1, cap, new Array(n).fill(1 / n));
  }

  /** 報酬最高的組合：依報酬由高到低逐一填到上限（線性規劃的精確解）。 */
  function maxReturn(mu, cap) {
    const w = new Array(mu.length).fill(0);
    let left = 1;
    mu
      .map((m, i) => [m, i])
      .sort((a, b) => b[0] - a[0])
      .forEach(([, i]) => {
        const x = Math.min(cap, left);
        w[i] = x;
        left -= x;
      });
    return w;
  }

  function cleanWeights(w) {
    const c = w.map((x) => (Math.abs(x) < EPS ? 0 : x));
    const s = c.reduce((a, b) => a + b, 0);
    return c.map((x) => x / s);
  }

  function stats(w, data) {
    const ret = dot(w, data.mu);
    const risk = Math.sqrt(quad(w, data.cov));
    return { return: ret, risk, sharpe: risk > 0 ? (ret - data.riskFree) / risk : 0 };
  }

  /**
   * @param {number} score 0–100 的基準風險分數
   * @returns {{ holdings: Array, ret: number, risk: number, sharpe: number, targetRisk: number }}
   */
  function optimize(score, data) {
    data = data || RoboAdvisor.portfolioData;
    const cap = data.maxWeight;
    const wMin = cleanWeights(minVariance(data.cov, cap));
    const wMax = cleanWeights(maxReturn(data.mu, cap));
    const riskLo = stats(wMin, data).risk;
    const riskHi = stats(wMax, data).risk;
    const clamped = Math.min(100, Math.max(0, Number(score) || 0));
    const targetRisk = riskLo + (clamped / 100) * (riskHi - riskLo);

    let w;
    if (targetRisk >= riskHi - 1e-12) {
      w = wMax;
    } else if (targetRisk <= riskLo + 1e-12) {
      w = wMin;
    } else {
      // λ 越大風險越低：二分搜尋找出風險剛好等於目標的 λ（對數尺度）
      let lo = 1e-4;
      let hi = 1e4;
      let best = wMin;
      for (let k = 0; k < 60; k += 1) {
        const lambda = Math.sqrt(lo * hi);
        const cand = solveLagrangian(data.mu, data.cov, lambda, cap, best);
        const risk = Math.sqrt(quad(cand, data.cov));
        if (risk > targetRisk) lo = lambda;
        else {
          hi = lambda;
          best = cand;
        }
        if (Math.abs(risk - targetRisk) < 1e-9) break;
      }
      w = best;
    }
    w = cleanWeights(w);
    const s = stats(w, data);

    const holdings = data.assets
      .map((a, i) => ({ code: a.code, name: a.name, assetClass: a.assetClass, weight: w[i] }))
      .filter((h) => h.weight > 0)
      .sort((a, b) => b.weight - a.weight);
    return { holdings, ret: s.return, risk: s.risk, sharpe: s.sharpe, targetRisk };
  }

  return { optimize };
})();
