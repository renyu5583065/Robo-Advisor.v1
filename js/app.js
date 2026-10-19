/**
 * app.js
 * 
 * 【功能說明】
 * 第一階段（傳統風險評估問卷）的問卷精靈核心控制模組：
 * 1. 串接題庫資料（questions.js）與評分邏輯（scoring.js）。
 * 2. 控制單選題題目推進、選項點選切換與作答進度條。
 * 3. 第一階段完成後不會立即顯示結果頁，而是將畫面無縫切換至第二階段（app-phase2.js）；
 *    待第二階段開放式問答也完成後，才一併將雙階段結果繪製於同一結果頁上。
 */

// 使用 IIFE（立即執行函式）將變數與函式封裝在模組作用域中，避免變數污染全域（window）
(function () {
  // 1. 常數與題庫資料 (Constants & Data)
  const questions = RoboAdvisor.questions.phase1; // 取得第一階段的所有傳統風險評估題目
  const STORAGE_KEY = "roboAdvisorProfile";       // 本機 localStorage 儲存評估結果的鍵名 (Key)

  // 2. 狀態變數 (State)
  let currentIndex = 0;      // 當前作答中的題目索引（從 0 開始）
  let answers = {};          // 儲存各題作答結果，格式為 { [questionId]: optionIndex }
  let latestResults = null;  // 快取第一階段算出的評估結果物件

  // 3. DOM 元素選取 (取得 HTML 畫面上的節點)
  const wizardEl = document.getElementById("wizard");   // 第一階段問卷題目主容器
  const resultsEl = document.getElementById("results"); // 最終評估結果展示頁面容器

  // 進度條相關元素
  const progressFill = document.getElementById("progressFill");   // 進度條填色長條
  const progressLabel = document.getElementById("progressLabel"); // 進度條文字（例如：第 1 題，共 6 題）

  // 題目內容相關元素
  const qDimension = document.getElementById("qDimension"); // 當前題目的評估構面（例如：風險承受能力）
  const qText = document.getElementById("qText");           // 題目內文
  const qNote = document.getElementById("qNote");           // 補充說明文字（若無說明則自動隱藏）
  const qOptions = document.getElementById("qOptions");     // 選項按鈕的容器

  // 導覽按鈕
  const backBtn = document.getElementById("backBtn"); // 上一題按鈕
  const nextBtn = document.getElementById("nextBtn"); // 下一題按鈕（最後一題時文字會轉為繼續下一階段）

  // 結果頁元素（第一階段結果欄位）
  const typeName = document.getElementById("typeName");               // 投資人類型名稱（例如：穩健型）
  const scoreNumber = document.getElementById("scoreNumber");         // 基準風險分數 (0~100)
  const typeDescription = document.getElementById("typeDescription"); // 投資人風格描述說明
  const capNotice = document.getElementById("capNotice");             // 風險上限降級提示區塊
  const capBefore = document.getElementById("capBefore");             // 降級前的原始投資人類型
  const capAfter = document.getElementById("capAfter");               // 降級後的最終投資人類型
  const capReasons = document.getElementById("capReasons");           // 觸發降級原因清單 (<ul>)
  const capBaseline = document.getElementById("capBaseline");         // 降級說明中的基準風險分數
  const capEffective = document.getElementById("capEffective");       // 降級說明中，配置實際採用的有效分數
  const breakdownList = document.getElementById("breakdownList");     // 各構面得分與答題清單 (<ul>)
  const retakeBtn = document.getElementById("retakeBtn");             // 「重新測驗」按鈕
  const downloadBtn = document.getElementById("downloadBtn");         // 「下載評估報告 (JSON)」按鈕

  // 4. 題目渲染與選項互動 (Question Rendering & Interaction)

  /**
   * 渲染指定索引的題目至畫面上
   * @param {number} index - 欲顯示題目的索引位置
   */
  function renderQuestion(index) {
    const q = questions[index];

    // 更新進度條長度比例與進度文字
    progressFill.style.width = `${((index + 1) / questions.length) * 100}%`;
    progressLabel.textContent = `第 ${index + 1} 題，共 ${questions.length} 題`;

    // 填入題目構面、題目文字與註記
    qDimension.textContent = q.dimension;
    qText.textContent = q.question;
    qNote.textContent = q.note || "";
    // 若該題目沒有補充註解，則為 qNote 加上 "hidden" class 加以隱藏
    qNote.classList.toggle("hidden", !q.note);

    // 清空並重新產生選項按鈕清單
    qOptions.innerHTML = "";
    q.options.forEach((option, optionIndex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      // 具備無障礙 (Accessibility / a11y) 屬性支援，宣告此按鈕如同單選題 radio
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", answers[q.id] === optionIndex ? "true" : "false");
      // 若此選項為目前使用者的選取項，加上選取樣式 class
      if (answers[q.id] === optionIndex) btn.classList.add("is-selected");

      // 選項內部結構：圓點圖示 + 選項文字
      btn.innerHTML = `<span class="option__dot" aria-hidden="true"></span><span>${option.text}</span>`;
      // 點擊選項時記錄答案
      btn.addEventListener("click", () => selectOption(q.id, optionIndex));
      qOptions.appendChild(btn);
    });

    // 第一題時隱藏「上一題」按鈕
    backBtn.disabled = index === 0;
    backBtn.style.visibility = index === 0 ? "hidden" : "visible";

    // 最後一題將按鈕文字切換為前往第二階段；若尚未選取選項則禁用「下一題」按鈕
    const isLast = index === questions.length - 1;
    nextBtn.textContent = isLast ? "繼續：行為與情緒評估" : "下一題";
    nextBtn.disabled = answers[q.id] === undefined;
  }

  /**
   * 使用者點選選項時的處理函式
   * @param {string} questionId - 題目的唯一識別碼
   * @param {number} optionIndex - 所點選的選項索引
   */
  function selectOption(questionId, optionIndex) {
    answers[questionId] = optionIndex; // 記錄使用者的選擇
    renderQuestion(currentIndex);      // 重新繪製當前題目以更新樣式與下一題按鈕狀態
  }

  // 5. 導覽控制與階段結算 (Navigation & Phase 1 Completion)

  /**
   * 前往下一題；若當前已是最後一題則結算第一階段
   */
  function goNext() {
    const isLast = currentIndex === questions.length - 1;
    if (isLast) {
      finishPhase1();
      return;
    }
    currentIndex += 1;
    renderQuestion(currentIndex);
  }

  /**
   * 回到上一題（若已在第一題則不作任何動作）
   */
  function goBack() {
    if (currentIndex === 0) return;
    currentIndex -= 1;
    renderQuestion(currentIndex);
  }

  /**
   * 完成第一階段：
   * 1. 呼叫計分模組計算分數與投資人類型。
   * 2. 將第一階段結果暫存至 localStorage。
   * 3. 隱藏第一階段題目區塊，啟動第二階段問卷（開放式行為問答）。
   */
  function finishPhase1() {
    latestResults = RoboAdvisor.scoring.computeResults(questions, answers);
    saveResults(latestResults);

    wizardEl.classList.add("hidden");
    RoboAdvisor.phase2.start();
  }

  // 6. 結果繪製與資料儲存 (Result Rendering & Storage)

  /**
   * 將第一階段的計算結果渲染進共用結果頁中（此函式由 app-phase2.js 於全部完成後呼叫）
   */
  function renderResultsSection() {
    const results = latestResults;
    if (!results) return;

    // 將投資人類型的代表色彩設為 CSS 變數，供整份結果頁與第二階段進度條共用配色主題
    resultsEl.style.setProperty("--type-color", results.type.color);
    typeName.textContent = results.type.name;
    scoreNumber.textContent = results.baselineScore;
    typeDescription.textContent = results.type.desc;

    // 若使用者的風險承受意願雖然高，但因財務能力或年齡限制而被規則降級（例如積極型調降為穩健型）
    const adjusted = results.type !== results.rawType;
    capNotice.classList.toggle("hidden", !adjusted); // 控制降級說明區塊的顯示/隱藏
    capReasons.innerHTML = "";
    if (adjusted) {
      capBefore.textContent = results.rawType.name;
      capAfter.textContent = results.type.name;
      capBaseline.textContent = results.baselineScore;
      capEffective.textContent = results.effectiveScore;
      results.capReasons.forEach((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        capReasons.appendChild(li);
      });
    }

    // 繪製各構面詳細得分與作答項目的水平長條圖清單
    breakdownList.innerHTML = "";
    results.breakdown.forEach((item) => {
      const li = document.createElement("li");
      li.className = "breakdown-item";
      li.innerHTML = `
        <span class="breakdown-item__label">${item.dimension}</span>
        <span class="breakdown-item__answer">${item.answer.text}</span>
        <span class="breakdown-item__bar-track">
          <span class="breakdown-item__bar-fill" style="width:${(item.score / 5) * 100}%; background:${results.type.color}"></span>
        </span>
         <span class="breakdown-item__score">${item.score} / 5</span>
      `;
      breakdownList.appendChild(li);
    });

    // 繪製第一階段傳統風險五大構面的雷達圖 (Radar Chart)
    RoboAdvisor.renderRadarChart("radarCanvas", results.breakdown, results.type.color, "傳統風險輪廓");
  }

  /**
   * 將第一階段作答記錄與計分結果儲存至 localStorage
   * @param {Object} results - 計分模組回傳的計算結果物件
   */
  function saveResults(results) {
    let profile = {};
    try {
      profile = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      profile = {};
    }
    // 將 phase1 結果儲存進個人檔案中，並加上完成時間戳記
    profile.phase1 = {
      answers,
      average: results.average,
      baselineScore: results.baselineScore,
      effectiveScore: results.effectiveScore,
      investorType: results.type.key,
      rawInvestorType: results.rawType.key,
      capacityAverage: results.capacityAverage,
      capReasons: results.capReasons,
      completedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  }

  // 7. 重新測驗與報告下載 (Retake & Download)

  /**
   * 重新測驗：重設所有階段的狀態變數，隱藏結果頁與投資組合頁，並返回最開始的暱稱輸入畫面
   */
  function retake() {
    currentIndex = 0;
    answers = {};
    latestResults = null;
    RoboAdvisor.phase2.reset(); // 清空第二階段狀態

    resultsEl.classList.add("hidden");
    document.getElementById("portfolioPage").classList.add("hidden");
    renderQuestion(0);
    RoboAdvisor.nickname.show(); // 呼叫暱稱模組重新顯示輸入步驟
  }

  /**
   * 將 localStorage 儲存的完整評估結果與投資組合匯出為 JSON 檔案供使用者下載
   */
  function download() {
    const profile = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    // 將 JavaScript 物件轉換為格式化後的 JSON 字串並封裝為 Blob 二進位物件
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    // 建立臨時的 <a> 標籤觸發瀏覽器下載行為
    const a = document.createElement("a");
    a.href = url;
    a.download = "robo-advisor-profile.json";
    document.body.appendChild(a);
    a.click();
    // 下載完成後清理 DOM 元素並釋放 URL 物件資源，防止記憶體洩漏
    a.remove();
    URL.revokeObjectURL(url);
  }

  // 8. 跨模組協同方法 (Cross-Module Communication)

  /**
   * 提供給 app-phase2.js 呼叫：當使用者在第二階段第一題點擊「上一題」時，回到第一階段的最後一題
   */
  function showLastQuestion() {
    currentIndex = questions.length - 1;
    renderQuestion(currentIndex);
    wizardEl.classList.remove("hidden");
    wizardEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // 9. 事件監聽 (Event Listeners)
  nextBtn.addEventListener("click", goNext);         // 點擊「下一題」或「繼續：行為與情緒評估」
  backBtn.addEventListener("click", goBack);         // 點擊「上一題」
  retakeBtn.addEventListener("click", retake);       // 點擊「重新測驗」
  downloadBtn.addEventListener("click", download);   // 點擊「下載評估結果 (JSON)」

  // 10. 匯出公開介面與初始化 (Public API & Initialization)
  // 將需要跨檔案調用的方法掛載至 RoboAdvisor.phase1 上
  RoboAdvisor.phase1 = {
    renderResultsSection,
    showLastQuestion,
  };

  // 頁面初始化：立即渲染第 1 題
  renderQuestion(currentIndex);
})();
