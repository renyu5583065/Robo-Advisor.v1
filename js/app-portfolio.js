/**
 * app-portfolio.js
 * 把「依基準風險分數即時最佳化」得到的建議投資組合畫進結果頁，
 * 並把結果存進 roboAdvisorProfile.portfolio（下載 JSON 時一併帶出）。
 */

window.RoboAdvisor = window.RoboAdvisor || {};

RoboAdvisor.portfolioView = (function () {
  const STORAGE_KEY = "roboAdvisorProfile";
  const PALETTE = ["#1d2e5c", "#14b8a6", "#c97c13", "#6d5bd0", "#d1495b", "#3b8ea5", "#8a9a5b", "#9aa3b5"];

  const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;

  function readBaselineScore() {
    try {
      const profile = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      return profile.phase1 ? Number(profile.phase1.baselineScore) : null;
    } catch (e) {
      return null;
    }
  }

  function save(score, result) {
    let profile = {};
    try {
      profile = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      profile = {};
    }
    profile.portfolio = {
      baselineScore: score,
      holdings: result.holdings.map((h) => ({ code: h.code, name: h.name, weight: Number(h.weight.toFixed(4)) })),
      expectedReturn: result.ret,
      volatility: result.risk,
      sharpe: result.sharpe,
      computedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
      /* 存不進去不影響畫面 */
    }
  }

  function drawDoughnut(holdings) {
    const canvas = document.getElementById("portfolioCanvas");
    if (!canvas) return;
    if (typeof Chart === "undefined") {
      canvas.classList.add("hidden");
      return;
    }
    canvas.classList.remove("hidden");
    const inst = RoboAdvisor.chartInstances && RoboAdvisor.chartInstances.portfolioCanvas;
    if (inst) inst.destroy();
    RoboAdvisor.chartInstances = RoboAdvisor.chartInstances || {};
    try {
      RoboAdvisor.chartInstances.portfolioCanvas = new Chart(canvas.getContext("2d"), {
        type: "doughnut",
        data: {
          labels: holdings.map((h) => `${h.name}（${h.code}）`),
          datasets: [
            {
              data: holdings.map((h) => Number((h.weight * 100).toFixed(2))),
              backgroundColor: holdings.map((_, i) => PALETTE[i % PALETTE.length]),
              borderColor: "#fff",
              borderWidth: 2,
            },
          ],
        },
        options: {
          cutout: "58%",
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (c) => `${c.label}：${c.parsed.toFixed(1)}%` } },
          },
        },
      });
    } catch (e) {
      console.error("建議投資組合圖表繪製失敗", e);
      canvas.classList.add("hidden");
    }
  }

  function render() {
    const section = document.getElementById("portfolioBlock");
    if (!section) return;
    const data = RoboAdvisor.portfolioData;
    const score = readBaselineScore();
    if (!data || !RoboAdvisor.portfolio || score === null || Number.isNaN(score)) {
      section.classList.add("hidden");
      return;
    }

    const result = RoboAdvisor.portfolio.optimize(score, data);
    section.classList.remove("hidden");

    document.getElementById("portfolioScore").textContent = score;
    document.getElementById("portfolioReturn").textContent = pct(result.ret);
    document.getElementById("portfolioRisk").textContent = pct(result.risk);
    document.getElementById("portfolioSharpe").textContent = result.sharpe.toFixed(2);
    document.getElementById("portfolioPeriod").textContent = `${data.period[0]} ~ ${data.period[1]}`;

    const list = document.getElementById("portfolioList");
    list.innerHTML = "";
    result.holdings.forEach((h, i) => {
      const color = PALETTE[i % PALETTE.length];
      const li = document.createElement("li");
      li.className = "holding";
      li.innerHTML = `
        <span class="holding__name"><span class="holding__dot" style="background:${color}"></span></span>
        <span class="holding__class"></span>
        <span class="holding__weight">${pct(h.weight)}</span>
        <span class="holding__bar-track"><span class="holding__bar-fill" style="width:${(h.weight / data.maxWeight) * 100}%; background:${color}"></span></span>
      `;
      // 名稱與類別用 textContent 塞入，避免資料裡的字元被當成 HTML
      li.querySelector(".holding__name").append(`${h.name}（${h.code}）`);
      li.querySelector(".holding__class").textContent = h.assetClass;
      list.appendChild(li);
    });

    drawDoughnut(result.holdings);
    save(score, result);
  }

  /** 結果頁與建議投資組合頁之間切換（兩頁都是 card，一次只顯示一頁）。 */
  function show(pageId) {
    const results = document.getElementById("results");
    const page = document.getElementById("portfolioPage");
    results.classList.toggle("hidden", pageId !== "results");
    page.classList.toggle("hidden", pageId !== "portfolio");
    // 先顯示頁面再畫圖，Chart.js 才量得到容器大小
    if (pageId === "portfolio") render();
    (pageId === "portfolio" ? page : results).scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.getElementById("toPortfolioBtn").addEventListener("click", () => show("portfolio"));
  document.getElementById("backToResultsBtn").addEventListener("click", () => show("results"));

  return { render };
})();
