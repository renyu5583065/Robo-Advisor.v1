/**
 * chart.js
 * Chart.js 的雷達圖包裝函式，讓 app.js 不需要直接處理 Chart.js 的 API。
 * 獨立成一支檔案，方便之後某個階段疊加第二組資料集
 * （例如把「行為情緒」雷達圖疊在「傳統風險」雷達圖上），
 * 而不用動到 app.js。
 *
 * 結果頁會同時出現兩張雷達圖（傳統風險構面 + 行為情緒指標），
 * 所以圖表實例以 canvas 的 id 分開保存，重畫某一張時才不會
 * 把另一張一起銷毀。
 */

window.RoboAdvisor = window.RoboAdvisor || {};

RoboAdvisor.chartInstances = {};

/**
 * 雷達圖畫不出來（例如離線、CDN 被擋掉，導致 Chart.js 沒載入）時，
 * 不應該讓整個結果頁跟著壞掉——分數與文字說明本身才是結果的主體。
 * 這裡改成：畫不出來就把 canvas 換成一行說明，並回傳 false。
 */
function showChartFallback(canvas) {
  canvas.classList.add("hidden");

  const parent = canvas.parentElement;
  if (!parent || parent.querySelector(".chart-fallback")) return;

  const note = document.createElement("p");
  note.className = "chart-fallback";
  note.textContent = "雷達圖需要連線載入 Chart.js，目前無法顯示；下方的分數明細仍是完整的評估結果。";
  parent.appendChild(note);
}

RoboAdvisor.renderRadarChart = function (canvasId, breakdown, colorHex, label) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return false;

  if (typeof Chart === "undefined") {
    console.error(`Chart.js 未載入，無法繪製 ${canvasId}`);
    showChartFallback(canvas);
    return false;
  }

  const ctx = canvas.getContext("2d");

  const labels = breakdown.map((item) => item.dimension);
  const data = breakdown.map((item) => item.score);

  if (RoboAdvisor.chartInstances[canvasId]) {
    RoboAdvisor.chartInstances[canvasId].destroy();
    delete RoboAdvisor.chartInstances[canvasId];
  }

  try {
    RoboAdvisor.chartInstances[canvasId] = new Chart(ctx, {
      type: "radar",
      data: {
        labels: labels,
        datasets: [
          {
            label: label || "你的風險輪廓",
            data: data,
            backgroundColor: colorHex + "33", // ~20% opacity fill
            borderColor: colorHex,
            borderWidth: 2,
            pointBackgroundColor: colorHex,
            pointRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          r: {
            min: 0,
            max: 5,
            ticks: { stepSize: 1, showLabelBackdrop: false },
            grid: { color: "#f6d3da" },
            angleLines: { color: "#f6d3da" },
            pointLabels: {
              font: { size: 11 },
              color: "#7a6b70",
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.raw} / 5`,
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

  return true;
};
