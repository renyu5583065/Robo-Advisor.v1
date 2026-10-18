/**
 * app-phase2.js
 * 分析運算由 sentiment.js 處理，或送至後端進行 LLM（大型語言模型）語意分析。
 * 【串接流程】
 * 1. 緊接著第一階段結束後自動啟動（呼叫 start()）。
 * 2. 使用者填寫完成最後一題並送出時，會同時彙整第一階段（投資類型）與第二階段（行為情緒指標），
 *    在同一結果頁面完整繪製並顯示。
 * 3. 題目下方會自動產生「範例回答按鈕」，點擊即可一鍵帶入文字，方便測試與示範。
 */

// 使用 IIFE（立即執行函式）將此模組的變數與函式封裝起來，避免污染全域命名空間
(function () {
  // 1. 常數與題庫資料 (Constants & Data)
  const questions = RoboAdvisor.questions.phase2; // 取得第二階段的所有開放式問題題庫
  const STORAGE_KEY = "roboAdvisorProfile";       // 本機 localStorage 儲存評估結果的鍵名 (Key)

  // 2. 狀態變數 (State)
  let currentIndex = 0; // 當前正在作答的題目索引（從 0 開始）
  let answers = {};     // 記錄使用者各題的回答內容，格式為 { [questionId]: "回答文字" }

  // 3. DOM 元素選取 (取得 HTML 畫面上的節點)
  const wizard2El = document.getElementById("wizard2"); // 第二階段問卷主容器
  const resultsEl = document.getElementById("results"); // 最終完整結果展示區塊容器

  // 進度條相關元素
  const progressFill2 = document.getElementById("progressFill2");   // 進度條填色長條
  const progressLabel2 = document.getElementById("progressLabel2"); // 進度條文字（例如：第 1 題，共 4 題）

  // 當前題目內容元素
  const qIndicatorHint2 = document.getElementById("qIndicatorHint2"); // 本題觀察的心理指標標籤提示
  const qText2 = document.getElementById("qText2");                   // 題目問題內文
  const qAnswer2 = document.getElementById("qAnswer2");               // 使用者文字輸入框 (<textarea>)
  const qExamples2 = document.getElementById("qExamples2");           // 範例回答晶片按鈕容器

  // 導覽按鈕
  const backBtn2 = document.getElementById("backBtn2"); // 上一題按鈕（第一題時會變成「回上一階段」）
  const nextBtn2 = document.getElementById("nextBtn2"); // 下一題按鈕（最後一題時會變成「查看完整評估結果」）

  // 結果頁中的第二階段欄位元素
  const dominantName2 = document.getElementById("dominantName2");   // 最顯著的行為情緒特徵名稱
  const lowSignalNote2 = document.getElementById("lowSignalNote2"); // 線索不足（低信號）時的提示區塊
  const breakdownList2 = document.getElementById("breakdownList2"); // 各指標分數與依據清單 (<ul>)
  const alertsList2 = document.getElementById("alertsList2");       // 偏誤風險提醒清單 (<ul>)
  const noAlertsNote2 = document.getElementById("noAlertsNote2");   // 無特殊偏誤警示時的提示文字
  const analysisSource2 = document.getElementById("analysisSource2"); // 標示分析來源（AI 語意分析 或 本地關鍵字分析）
  const resultNickname = document.getElementById("resultNickname");   // 結果頁顯示的使用者暱稱
  const submitStatus = document.getElementById("submitStatus");       // 結果寫入後端的狀態回饋文字

  // 4. 對應字典 (Dictionaries for Display)
  // 將英文的指標鍵值轉為繁體中文標籤
  const indicatorLabels = {
    anxiety: "焦慮",
    lossAversion: "損失規避",
    confidence: "自信程度",
    herding: "從眾傾向",
    overconfidence: "過度自信",
    confirmationBias: "確認偏誤",
    dispositionEffect: "處置效應",
  };

  // 信心度等級的中文對應
  const confidenceLabels = { high: "高", medium: "中", low: "低" };

  // 5. 畫面渲染與題目切換 (Rendering & Question Navigation)

  /**
   * 渲染指定索引的題目到畫面上
   * @param {number} index - 題目的索引位置
   */
  function renderQuestion(index) {
    const q = questions[index];

    // 更新進度條長度與文字
    progressFill2.style.width = `${((index + 1) / questions.length) * 100}%`;
    progressLabel2.textContent = `第 ${index + 1} 題，共 ${questions.length} 題`;

    // 顯示本題所觀察的指標中文名稱（若有多個以頓號分隔）
    qIndicatorHint2.textContent = `觀察指標：${q.indicators.map((key) => indicatorLabels[key]).join("、")}`;
    qText2.textContent = q.prompt;
    qAnswer2.placeholder = q.placeholder;
    // 還原使用者先前輸入過的內容（若無則為空字串）
    qAnswer2.value = answers[q.id] || "";

    // 產生此題的範例回答快速按鈕
    renderExamples(q);

    // 第一題時按上一題會回到第一階段的最後一題；其他題目則顯示「上一題」
    backBtn2.textContent = index === 0 ? "回上一階段" : "上一題";

    // 最後一題將按鈕文字改為「查看完整評估結果」
    const isLast = index === questions.length - 1;
    nextBtn2.textContent = isLast ? "查看完整評估結果" : "下一題";

    // 依據是否有輸入文字來決定「下一題」按鈕是否可點擊
    updateNextEnabled();
  }

  /**
   * 根據題目物件中的範例清單，動態產生範例回答按鈕
   * @param {Object} q - 題目物件
   */
  function renderExamples(q) {
    qExamples2.innerHTML = ""; // 清空先前的範例按鈕
    if (!q.examples || q.examples.length === 0) return;

    // 建立提示標題文字
    const label = document.createElement("p");
    label.className = "examples__label";
    label.textContent = "範例回答（點一下套用，方便測試）：";
    qExamples2.appendChild(label);

    // 建立範例按鈕的清單容器
    const list = document.createElement("div");
    list.className = "examples__list";

    q.examples.forEach((example, exampleIndex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "example-chip";
      btn.textContent = `範例 ${exampleIndex + 1}：${example}`;

      // 點擊範例按鈕時，自動將範例內容填入文字框，並聚焦輸入框
      btn.addEventListener("click", () => {
        qAnswer2.value = example;
        updateNextEnabled(); // 更新按鈕啟用狀態
        qAnswer2.focus();     // 游標聚焦到輸入框
      });
      list.appendChild(btn);
    });
    qExamples2.appendChild(list);
  }

  /**
   * 檢查輸入框內容並同步記錄到 answers 物件，若未輸入任何文字則禁用「下一題」按鈕
   */
  function updateNextEnabled() {
    const q = questions[currentIndex];
    const text = qAnswer2.value.trim();
    answers[q.id] = text;
    // 當去除空白後的字串長度為 0 時禁用按鈕
    nextBtn2.disabled = text.length === 0;
  }

  /**
   * 前往下一題；若當前已是最後一題則觸發分析流程
   */
  function goNext() {
    const isLast = currentIndex === questions.length - 1;
    if (isLast) {
      analyze(); // 進入分析與結果呈現
      return;
    }
    currentIndex += 1;
    renderQuestion(currentIndex);
  }

  /**
   * 回到上一題；若在第一題則回到第一階段的最後一題
   */
  function goBack() {
    if (currentIndex === 0) {
      // 隱藏第二階段畫面，喚起第一階段問卷並定位在最後一題
      wizard2El.classList.add("hidden");
      RoboAdvisor.phase1.showLastQuestion();
      return;
    }
    currentIndex -= 1;
    renderQuestion(currentIndex);
  }

  // 6. 分析邏輯與後端 API 呼叫 (Analysis & Backend Integration)

  /**
   * 發送 HTTP POST 請求至後端呼叫大型語言模型 (LLM) 進行進階語意分析
   * @param {Array} responses - 使用者的所有回答資料陣列
   * @returns {Promise<Object>} 回傳情緒分析評估結果
   */
  async function requestLlmAnalysis(responses) {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        responses: responses.map((r) => ({
          prompt: questions.find((q) => q.id === r.id).prompt,
          text: r.text,
        })),
      }),
    });
    // 若 HTTP 狀態碼非 200~299 則拋出例外錯誤
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // 使用 sentiment.js 的 fromScores 方法將後端回傳的分數整合成完整指標結果
    return RoboAdvisor.sentiment.fromScores(data.scores, responses);
  }

  /**
   * 統整回答並執行分析的核心流程：
   * 採用優雅降級（Graceful Degradation）策略——優先連線後端 LLM，
   * 若連線失敗或後端未設定金鑰，則自動退回本地端 sentiment.js 的關鍵字比對分析，
   * 確保使用者隨時都能順利獲得評估結果。
   */
  async function analyze() {
    // 整理所有題目的回答內容與對應的指標清單
    const responses = questions.map((q) => ({
      id: q.id,
      indicators: q.indicators,
      text: answers[q.id] || "",
    }));

    // 進入分析狀態：禁用按鈕並切換按鈕文字，避免重複點擊
    nextBtn2.disabled = true;
    backBtn2.disabled = true;
    nextBtn2.textContent = "分析中⋯";

    let results;
    try {
      // 優先嘗試呼叫後端 LLM 分析
      results = await requestLlmAnalysis(responses);
    } catch (e) {
      // 後端不可用時，退回使用本地端關鍵字分析
      results = RoboAdvisor.sentiment.analyze(responses);
    }

    // 恢復按鈕狀態
    backBtn2.disabled = false;
    nextBtn2.textContent = "查看完整評估結果";
    nextBtn2.disabled = false;

    // 儲存結果到 localStorage、繪製結果畫面、並非同步送出備份至後端
    saveResults(responses, results);
    showAllResults(results);
    submitToBackend();
  }

  /**
   * 將暱稱與兩階段的完整問卷資料提交給後端儲存
   * 此操作為非同步背景執行，即使後端沒開（如純靜態開啟檔案）也不會卡死頁面，僅在畫面上顯示提示。
   */
  async function submitToBackend() {
    const nickname = RoboAdvisor.nickname.get(); // 取得先前輸入的暱稱
    resultNickname.textContent = nickname;
    submitStatus.textContent = "正在記錄結果⋯⋯";

    try {
      const profile = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, phase1: profile.phase1, phase2: profile.phase2 }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      submitStatus.textContent = "✓ 結果已記錄到後端";
    } catch (e) {
      submitStatus.textContent = `⚠ 結果未能記錄到後端（${e.message}）`;
    }
  }

  // 7. 結果頁面繪製 (Result Section Rendering)

  /**
   * 切換並展示完整結果頁面
   * 重要技巧：必須先移除 resultsEl 的 "hidden" class 使容器可見，再進行繪圖。
   * 因為 Chart.js 若在 display: none 的容器中初始化，會無法取得正確的 canvas 寬高而造成圖表變形或空白。
   * @param {Object} results - 第二階段的分析結果物件
   */
  function showAllResults(results) {
    wizard2El.classList.add("hidden");    // 隱藏第二階段題目
    resultsEl.classList.remove("hidden"); // 顯示最終結果頁面

    // 呼叫第一階段的繪圖與文字填寫邏輯（投資人型態、第一階段雷達圖等）
    RoboAdvisor.phase1.renderResultsSection();
    // 渲染第二階段專屬區塊（行為情緒指標分解條、警示、第二張雷達圖）
    renderPhase2Section(results);

    // 頁面平滑捲動至結果頂端
    resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * 繪製結果頁中屬於第二階段（行為情緒）的詳細內容
   * @param {Object} results - 第二階段的分析結果物件
   */
  function renderPhase2Section(results) {
    // 填入最顯著特徵維度名稱
    dominantName2.textContent = results.dominant.dimension;
    // 若文字線索太少（lowSignal 為 true），顯示提示文字
    lowSignalNote2.classList.toggle("hidden", !results.lowSignal);
    // 顯示分析依據來源標記
    analysisSource2.textContent =
      results.source === "llm"
        ? "分析方式：AI 語意分析（每個指標附上依據原句與信心度）"
        : "分析方式：簡易關鍵字分析（AI 分析未啟用或暫時無法使用，結果僅供參考）";

    // 繪製各指標的水平進度條與依據說明
    breakdownList2.innerHTML = "";
    results.breakdown.forEach((item) => {
      const li = document.createElement("li");
      li.className = "breakdown-item breakdown-item--indicator";
      li.innerHTML = `
        <span class="breakdown-item__label">${item.dimension}</span>
        <span class="breakdown-item__bar-track">
          <span class="breakdown-item__bar-fill" style="width:${(item.score / 5) * 100}%; background:var(--type-color)"></span>
        </span>
        <span class="breakdown-item__score">${item.score} / 5</span>
      `;

      // 建立引證依據的文字標籤（使用 textContent 填入，可防止 XSS 惡意腳本注入攻擊）
      const note = document.createElement("span");
      note.className = "breakdown-item__evidence";
      note.textContent = item.evidence
        ? `依據：「${item.evidence}」（信心度：${confidenceLabels[item.confidence] || "低"}）`
        : `依據：回答中沒有足夠線索（信心度：${confidenceLabels[item.confidence] || "低"}）`;
      li.appendChild(note);

      breakdownList2.appendChild(li);
    });

    // 繪製行為偏誤風險提醒清單
    alertsList2.innerHTML = "";
    results.alerts.forEach((alert) => {
      const li = document.createElement("li");
      li.className = "alert-item";
      li.innerHTML = `<p>${alert.text}</p>`;
      alertsList2.appendChild(li);
    });
    // 若無任何警示提醒，顯示提示說明
    noAlertsNote2.classList.toggle("hidden", results.alerts.length > 0);

    // 取得當前投資人風格的主題代表顏色，用於繪製雷達圖
    const typeColor = getComputedStyle(resultsEl).getPropertyValue("--type-color").trim() || results.dominant.color;
    // 呼叫圖表模組繪製第二階段的心理指標雷達圖
    RoboAdvisor.renderRadarChart("radarCanvas2", results.breakdown, typeColor, "行為與情緒指標");
  }

  /**
   * 將使用者回答與分析結果以 JSON 格式儲存到 localStorage
   * @param {Array} responses - 使用者的原始回答資料
   * @param {Object} results - 分析運算產生的指標結果物件
   */
  function saveResults(responses, results) {
    let profile = {};
    try {
      profile = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      profile = {};
    }
    // 將 phase2 的資料併入既有的 profile 物件中
    profile.phase2 = {
      responses,
      source: results.source,
      breakdown: results.breakdown.map((item) => ({
        key: item.key,
        score: item.score,
        evidence: item.evidence,
        confidence: item.confidence,
      })),
      dominant: results.dominant.key,
      alerts: results.alerts,
      lowSignal: results.lowSignal,
      completedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  }

  // 8. 流程控制公開方法 (Lifecycle Methods)

  /** 由第一階段做完後呼叫，接著顯示開放式問題 */
  function start() {
    renderQuestion(currentIndex);
    wizard2El.classList.remove("hidden");
    wizard2El.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** 重新測驗時由外部呼叫：清空狀態變數與輸入資料，並隱藏第二階段區塊 */
  function reset() {
    currentIndex = 0;
    answers = {};
    wizard2El.classList.add("hidden");
  }

  // 9. 事件監聽 (Event Listeners)
  nextBtn2.addEventListener("click", goNext);           // 點擊「下一題」或「查看完整評估結果」
  backBtn2.addEventListener("click", goBack);           // 點擊「上一題」或「回上一階段」
  qAnswer2.addEventListener("input", updateNextEnabled); // 監聽文字輸入，即時更新按鈕是否可按

  // 10. 匯出介面給全域使用 (Public API)
  // 將 start 與 reset 方法掛載到 RoboAdvisor 物件上，供 app.js 呼叫
  RoboAdvisor.phase2 = { start, reset };
})();
