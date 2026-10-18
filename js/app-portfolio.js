/**
 * app-portfolio.js
 * 
 * 【功能說明】
 * 建議投資組合視圖模組：
 * 依據使用者的「第一階段基準風險分數」，呼叫後端的 Python 最佳化程式（MPT 現代投資組合理論）
 * 計算出客製化的資產配置比例，並將結果繪製於畫面（圓餅圖與持股清單）。
 * 同時將計算結果存入 localStorage，便於使用者匯出下載完整評估報告。
 */

// 確保全域命名空間物件 RoboAdvisor 存在（若尚未建立則初始化為空物件）
window.RoboAdvisor = window.RoboAdvisor || {};

// 使用 IIFE（立即執行函式）模組化封裝，最後將需要對外公開的方法回傳給 RoboAdvisor.portfolioView
RoboAdvisor.portfolioView = (function () {
  // 1. 常數與色盤設定 (Constants & Palette)
  const STORAGE_KEY = "roboAdvisorProfile"; // 儲存使用者問卷與投資組合資料的 localStorage 鍵名
  // 各資產類別在圖表與清單中使用的代表顏色色盤
  const PALETTE = ["#1d2e5c", "#14b8a6", "#c97c13", "#6d5bd0", "#d1495b", "#3b8ea5", "#8a9a5b", "#9aa3b5"];

  // 2. 輔助函式 (Helper Functions)
  /**
   * 將數值小數轉換為百分比字串格式
   * 例如：pct(0.1234, 1) 會轉換為 "12.3%"
   * @param {number} x - 欲轉換的小數數值
   * @param {number} digits - 保留的小數位數（預設為 1 位）
   */
  const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;

  /**
   * 從本機 localStorage 中讀取第一階段測出的「基準風險分數」
   * @returns {number|null} 風險分數（若讀取失敗或無資料則回傳 null）
   */
  function readBaselineScore() {
    try {
      const profile = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      // 確認是否有第一階段資料，若有則將分數轉為數值型態回傳
      return profile.phase1 ? Number(profile.phase1.baselineScore) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 將計算出的投資組合結果儲存到 localStorage
   * @param {number} score - 基準風險分數
   * @param {Object} result - 最佳化演算法計算出的投資組合成果物件
   */
  function save(score, result) {
    let profile = {};
    try {
      profile = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      profile = {};
    }
    // 將建議投資組合資訊寫入 profile.portfolio 欄位中
    profile.portfolio = {
      baselineScore: score,
      holdings: result.holdings.map((h) => ({ code: h.code, name: h.name, weight: Number(h.weight.toFixed(4)) })),
      expectedReturn: result.expectedReturn,
      volatility: result.volatility,
      sharpe: result.sharpe,
      computedAt: new Date().toISOString(), // 記錄計算完成的時間戳記
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
      /* 若瀏覽器限制寫入 localStorage，不中斷畫面的正常顯示 */
    }
  }

  // 3. 圖表繪製 (Chart.js Doughnut Chart)
  /**
   * 使用 Chart.js 繪製資產配置的甜甜圈圓餅圖 (Doughnut Chart)
   * @param {Array} holdings - 各資產持股比重陣列
   */
  function drawDoughnut(holdings) {
    const canvas = document.getElementById("portfolioCanvas");
    if (!canvas) return;

    // 檢查全域環境是否已載入 Chart.js 函式庫，若未載入則隱藏畫布避免報錯
    if (typeof Chart === "undefined") {
      canvas.classList.add("hidden");
      return;
    }
    canvas.classList.remove("hidden");

    // 避免重複建立圖表：若先前已存在圖表實例，必須先呼叫 destroy() 銷毀，防止記憶體洩漏與畫面重疊閃爍
    const inst = RoboAdvisor.chartInstances && RoboAdvisor.chartInstances.portfolioCanvas;
    if (inst) inst.destroy();
    RoboAdvisor.chartInstances = RoboAdvisor.chartInstances || {};

    try {
      // 建立新的甜甜圈圓餅圖實例
      RoboAdvisor.chartInstances.portfolioCanvas = new Chart(canvas.getContext("2d"), {
        type: "doughnut",
        data: {
          // 圓餅圖各區塊標籤（顯示：資產名稱與股票代號）
          labels: holdings.map((h) => `${h.name}（${h.code}）`),
          datasets: [
            {
              // 權重數值轉換為百分比數字
              data: holdings.map((h) => Number((h.weight * 100).toFixed(2))),
              // 依序套用色盤色彩
              backgroundColor: holdings.map((_, i) => PALETTE[i % PALETTE.length]),
              borderColor: "#fff", // 區塊間的白色間隔線
              borderWidth: 2,
            },
          ],
        },
        options: {
          cutout: "58%", // 設定中心挖空比例，形成甜甜圈造型
          plugins: {
            legend: { display: false }, // 隱藏圖例（下方清單已有詳細標示）
            tooltip: {
              // 自訂滑鼠懸停時顯示的提示文字格式
              callbacks: { label: (c) => `${c.label}：${c.parsed.toFixed(1)}%` },
            },
          },
        },
      });
    } catch (e) {
      console.error("建議投資組合圖表繪製失敗", e);
      canvas.classList.add("hidden");
    }
  }

  // 4. 向後端取得最適配置 (Call Python via API)
  // 暫存最近一次的計算結果，使用者來回切換頁面時不必重複呼叫 Python
  let cache = { score: null, result: null };

  /**
   * 把風險分數送到後端 /api/portfolio，由 Python（scipy 最佳化）即時算出權重
   * @param {number} score - 基準風險分數（0–100）
   */
  async function fetchPortfolio(score) {
    if (cache.score === score && cache.result) return cache.result;
    const res = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    cache = { score, result };
    return result;
  }

  /** 顯示「計算中」或錯誤訊息；message 為空字串時隱藏狀態列，顯示結果內容。 */
  function setStatus(message, isError) {
    const status = document.getElementById("portfolioStatus");
    const content = document.getElementById("portfolioContent");
    status.textContent = message;
    status.classList.toggle("hidden", !message);
    status.classList.toggle("portfolio-status--error", Boolean(isError));
    content.classList.toggle("hidden", Boolean(message));
  }

  // 5. 畫面渲染主函式 (Main Render)
  /**
   * 取得 Python 最佳化結果，並將所有數值、清單與圖表渲染至頁面
   */
  async function render() {
    const section = document.getElementById("portfolioBlock");
    if (!section) return;

    const score = readBaselineScore(); // 取得使用者評估分數
    if (score === null || Number.isNaN(score)) {
      setStatus("找不到風險分數，請先完成問卷。", true);
      return;
    }

    setStatus("正在由 Python 依你的風險分數計算最適投資組合…", false);

    let result;
    try {
      result = await fetchPortfolio(score);
    } catch (e) {
      console.error("取得建議投資組合失敗", e);
      setStatus("暫時無法計算建議投資組合，請稍後再試。", true);
      return;
    }
    setStatus("", false);

    // 填入關鍵指標數據到 HTML 元素中
    document.getElementById("portfolioScore").textContent = score;                              // 基準風險分數
    document.getElementById("portfolioReturn").textContent = pct(result.expectedReturn);        // 預期年化報酬率
    document.getElementById("portfolioRisk").textContent = pct(result.volatility);              // 年化波動度（風險）
    document.getElementById("portfolioSharpe").textContent = result.sharpe.toFixed(2);          // 夏普值 (Sharpe Ratio)
    document.getElementById("portfolioPeriod").textContent = `${result.period[0]} ~ ${result.period[1]}`; // 歷史資料區間

    // 繪製資產配置清單列表
    const list = document.getElementById("portfolioList");
    list.innerHTML = ""; // 清空先前的列表內容

    result.holdings.forEach((h, i) => {
      const color = PALETTE[i % PALETTE.length];
      const li = document.createElement("li");
      li.className = "holding";
      li.innerHTML = `
        <span class="holding__name"><span class="holding__dot" style="background:${color}"></span></span>
        <span class="holding__class"></span>
        <span class="holding__weight">${pct(h.weight)}</span>
        <span class="holding__bar-track"><span class="holding__bar-fill" style="width:${(h.weight / result.maxWeight) * 100}%; background:${color}"></span></span>
      `;
      // 安全性考量：使用 append 與 textContent 填入文字，避免資料中若含有特殊字元時被誤認為 HTML 造成 XSS 風險
      li.querySelector(".holding__name").append(`${h.name}（${h.code}）`);
      li.querySelector(".holding__class").textContent = h.assetClass;
      list.appendChild(li);
    });

    // 繪製甜甜圈圖表
    drawDoughnut(result.holdings);
    // 儲存結果至 localStorage
    save(score, result);
  }

  // 6. 頁面切換控制 (Page View Switching)
  /**
   * 在「評估結果頁」與「建議投資組合頁」之間切換
   * 兩頁皆為卡片設計 (card)，切換時透過 toggle 控制 "hidden" class
   * @param {string} pageId - "results"（評估結果頁）或 "portfolio"（投資組合建議頁）
   */
  function show(pageId) {
    const results = document.getElementById("results");
    const page = document.getElementById("portfolioPage");

    results.classList.toggle("hidden", pageId !== "results");
    page.classList.toggle("hidden", pageId !== "portfolio");

    // 重要觀念：必須先讓頁面解除隱藏（取消 display: none），Chart.js 才能正確量測容器尺寸並繪圖
    if (pageId === "portfolio") render();

    // 平滑捲動至目前切換顯示的頁面頂部
    (pageId === "portfolio" ? page : results).scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // 7. 事件監聽 (Event Listeners)
  // 點擊「查看建議投資組合」按鈕時切換到投資組合頁面
  document.getElementById("toPortfolioBtn").addEventListener("click", () => show("portfolio"));
  // 點擊「返回評估結果」按鈕時切換回結果頁面
  document.getElementById("backToResultsBtn").addEventListener("click", () => show("results"));

  // 8. 匯出公開介面 (Public API)
  return { render };
})();
