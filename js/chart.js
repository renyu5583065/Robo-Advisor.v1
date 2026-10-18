/**
 * chart.js
 * 
 * 【功能說明】
 * Chart.js 雷達圖（Radar Chart）封裝模組：
 * 1. 將 Chart.js 複雜的設定與繪圖細節包裝成簡潔的函式，讓主程式（app.js、app-phase2.js）呼叫時更乾淨。
 * 2. 支援同頁多張圖表管理：透過 canvasId 獨立儲存圖表實例（例如：傳統風險輪廓雷達圖、行為情緒指標雷達圖），
 *    重繪其中一張時不會影響或誤刪另一張。
 * 3. 內建容錯機制（Fallback）：若因離線或 CDN 連線異常導致 Chart.js 未載入，自動切換為友善文字提示，
 *    確保問卷分數與評估結果文字仍能正常呈現，不中斷使用者體驗。
 */

// 1. 全域命名空間與實例快取 (Namespace & Instances Cache)
// 確保全域物件 RoboAdvisor 存在（若尚未建立則初始化為空物件）
window.RoboAdvisor = window.RoboAdvisor || {};

// 建立圖表實例儲存庫，格式為：{ [canvasId]: ChartInstance }
// 目的：追蹤各個 canvas 當前運作中的圖表實例，供重繪時呼叫 destroy() 釋放資源
RoboAdvisor.chartInstances = {};

// 2. 容錯降級處理 (Fallback UI)
/**
 * 當圖表無法繪製時的替代畫面呈現函式
 * （例如在無網路環境、CDN 被阻擋導致 Chart.js 未載入時觸發）
 * @param {HTMLCanvasElement} canvas - 目標畫布元素
 */
function showChartFallback(canvas) {
  // 隱藏空白無效的 canvas 畫布
  canvas.classList.add("hidden");

  const parent = canvas.parentElement;
  // 若找不到父容器，或者已經加入過提示文字，則不重複建立
  if (!parent || parent.querySelector(".chart-fallback")) return;

  // 建立友善提示段落，告知使用者雖然圖表未顯示，但下方文字分數依然完整有效
  const note = document.createElement("p");
  note.className = "chart-fallback";
  note.textContent = "雷達圖需要連線載入 Chart.js，目前無法顯示；下方的分數明細仍是完整的評估結果。";
  parent.appendChild(note);
}

// 3. 雷達圖繪製主函式 (Radar Chart Renderer)
/**
 * 繪製或更新指定的五角/多角雷達圖
 * @param {string} canvasId - HTML 中 <canvas> 標籤的 id（例如："radarCanvas" 或 "radarCanvas2"）
 * @param {Array<Object>} breakdown - 構面分數資料陣列，格式為 [{ dimension: "構面名稱", score: 分數 }, ...]
 * @param {string} colorHex - 主題十六進位色碼（例如："#14b8a6"）
 * @param {string} label - 資料集的圖例說明標籤
 * @returns {boolean} 繪製成功回傳 true，失敗回傳 false
 */
RoboAdvisor.renderRadarChart = function (canvasId, breakdown, colorHex, label) {
  // 取得目標畫布元素
  const canvas = document.getElementById(canvasId);
  if (!canvas) return false;

  // 檢查外部的 Chart.js 函式庫是否已載入
  if (typeof Chart === "undefined") {
    console.error(`Chart.js 未載入，無法繪製 ${canvasId}`);
    showChartFallback(canvas); // 顯示替代提示文字
    return false;
  }

  // 取得 Canvas 的 2D 繪圖環境上下文 (Context)
  const ctx = canvas.getContext("2d");

  // 從資料陣列中提取雷達圖各軸的「向度標籤」與對應「數值」
  const labels = breakdown.map((item) => item.dimension);
  const data = breakdown.map((item) => item.score);

  // 重要防護：若此 canvasId 先前已經建立過圖表實例，必須先呼叫 destroy() 進行銷毀
  // 理由：若不銷毀直接 new Chart，會在同一個 canvas 上堆疊多個實例，造成記憶體洩漏與滑鼠懸停 (hover) 時殘影閃爍
  if (RoboAdvisor.chartInstances[canvasId]) {
    RoboAdvisor.chartInstances[canvasId].destroy();
    delete RoboAdvisor.chartInstances[canvasId];
  }

  try {
    // 建立並儲存新的雷達圖實例
    RoboAdvisor.chartInstances[canvasId] = new Chart(ctx, {
      type: "radar", // 圖表類型：雷達圖
      data: {
        labels: labels, // 多角形各頂點的標籤名稱
        datasets: [
          {
            label: label || "你的風險輪廓",
            data: data,
            // 技巧說明：colorHex + "33" 是 CSS 8 碼 Hex 色碼，後面的 "33" 代表約 20% 的半透明度填色
            backgroundColor: colorHex + "33",
            borderColor: colorHex,             // 雷達圖外框實線顏色
            borderWidth: 2,                    // 外框線寬
            pointBackgroundColor: colorHex,    // 各頂點端點的圓點顏色
            pointRadius: 4,                    // 端點圓點半徑大小
          },
        ],
      },
      options: {
        responsive: true,           // 自適應容器大小
        maintainAspectRatio: true,  // 維持固定的寬高比
        scales: {
          // r 代表雷達圖的徑向座標軸 (Radial Scale)
          r: {
            min: 0, // 分數最小值
            max: 5, // 分數最大值（各構面皆為 1~5 分）
            ticks: {
              stepSize: 1,             // 刻度間隔為 1
              showLabelBackdrop: false // 隱藏刻度數字後方的背景白色方塊，使畫面更清爽
            },
            grid: { color: "#f6d3da" },        // 蜘蛛網同心圓格線顏色
            angleLines: { color: "#f6d3da" },  // 從中心向外放射線顏色
            pointLabels: {
              font: { size: 11 },   // 頂點構面文字大小
              color: "#7a6b70",     // 頂點構面文字顏色
            },
          },
        },
        plugins: {
          legend: { display: false }, // 隱藏圖例（版面上已有文字標籤，不需重複圖例）
          tooltip: {
            // 自訂滑鼠懸停時的提示框內容
            callbacks: {
              label: (context) => `${context.raw} / 5`, // 顯示例如：「4 / 5」
            },
          },
        },
      },
    });
  } catch (err) {
    console.error(`繪製 ${canvasId} 失敗`, err);
    showChartFallback(canvas);
    return false;
  }

  return true; // 成功完成繪圖
};
