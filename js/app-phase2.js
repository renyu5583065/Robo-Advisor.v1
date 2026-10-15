/**
 * app-phase2.js
 * 第二階段（行為 / 情緒評估）的問卷精靈。流程跟 app.js 很像
 * （一次一題、進度條、最後一題變成「分析」），但收集的是自由
 * 文字，而不是選擇題；分析交給 sentiment.js，而不是 scoring.js。
 *
 * 這一階段接在第一階段之後自動開始；最後一題送出時，才會把
 * 兩個階段的結果——投資人類型（保守／穩健／積極）與行為情緒
 * 指標——一起畫進同一個結果頁並顯示出來。
 *
 * 每題下方會列出四個範例回答（來自 questions-phase2.js 的
 * examples），點一下就能直接套用到輸入框——方便測試人員快速
 * 走完整個流程，不用自己想文字內容。
 */

(function () {
  const questions = RoboAdvisor.questions.phase2;
  const STORAGE_KEY = "roboAdvisorProfile";

  let currentIndex = 0;
  let answers = {}; // { [questionId]: text }

  // ---- DOM references ----
  const wizard2El = document.getElementById("wizard2");
  const resultsEl = document.getElementById("results");

  const progressFill2 = document.getElementById("progressFill2");
  const progressLabel2 = document.getElementById("progressLabel2");

  const qIndicatorHint2 = document.getElementById("qIndicatorHint2");
  const qText2 = document.getElementById("qText2");
  const qAnswer2 = document.getElementById("qAnswer2");
  const qExamples2 = document.getElementById("qExamples2");

  const backBtn2 = document.getElementById("backBtn2");
  const nextBtn2 = document.getElementById("nextBtn2");

  const dominantName2 = document.getElementById("dominantName2");
  const lowSignalNote2 = document.getElementById("lowSignalNote2");
  const breakdownList2 = document.getElementById("breakdownList2");
  const alertsList2 = document.getElementById("alertsList2");
  const noAlertsNote2 = document.getElementById("noAlertsNote2");
  const analysisSource2 = document.getElementById("analysisSource2");
  const resultNickname = document.getElementById("resultNickname");
  const submitStatus = document.getElementById("submitStatus");

  const indicatorLabels = {
    anxiety: "焦慮",
    lossAversion: "損失規避",
    confidence: "自信程度",
    herding: "從眾傾向",
    overconfidence: "過度自信",
    confirmationBias: "確認偏誤",
    dispositionEffect: "處置效應",
  };

  const confidenceLabels = { high: "高", medium: "中", low: "低" };

  // ---- Rendering ----

  function renderQuestion(index) {
    const q = questions[index];

    progressFill2.style.width = `${((index + 1) / questions.length) * 100}%`;
    progressLabel2.textContent = `第 ${index + 1} 題，共 ${questions.length} 題`;

    qIndicatorHint2.textContent = `觀察指標：${q.indicators.map((key) => indicatorLabels[key]).join("、")}`;
    qText2.textContent = q.prompt;
    qAnswer2.placeholder = q.placeholder;
    qAnswer2.value = answers[q.id] || "";

    renderExamples(q);

    // 第一題的「上一題」會回到第一階段的最後一題
    backBtn2.textContent = index === 0 ? "回上一階段" : "上一題";

    const isLast = index === questions.length - 1;
    nextBtn2.textContent = isLast ? "查看完整評估結果" : "下一題";
    updateNextEnabled();
  }

  function renderExamples(q) {
    qExamples2.innerHTML = "";
    if (!q.examples || q.examples.length === 0) return;

    const label = document.createElement("p");
    label.className = "examples__label";
    label.textContent = "範例回答（點一下套用，方便測試）：";
    qExamples2.appendChild(label);

    const list = document.createElement("div");
    list.className = "examples__list";
    q.examples.forEach((example, exampleIndex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "example-chip";
      btn.textContent = `範例 ${exampleIndex + 1}：${example}`;
      btn.addEventListener("click", () => {
        qAnswer2.value = example;
        updateNextEnabled();
        qAnswer2.focus();
      });
      list.appendChild(btn);
    });
    qExamples2.appendChild(list);
  }

  function updateNextEnabled() {
    const q = questions[currentIndex];
    const text = qAnswer2.value.trim();
    answers[q.id] = text;
    nextBtn2.disabled = text.length === 0;
  }

  function goNext() {
    const isLast = currentIndex === questions.length - 1;
    if (isLast) {
      analyze();
      return;
    }
    currentIndex += 1;
    renderQuestion(currentIndex);
  }

  function goBack() {
    if (currentIndex === 0) {
      wizard2El.classList.add("hidden");
      RoboAdvisor.phase1.showLastQuestion();
      return;
    }
    currentIndex -= 1;
    renderQuestion(currentIndex);
  }

  /**
   * 先請後端用 LLM 分析；後端沒設定金鑰、連不上或回傳格式不對時，
   * 一律退回 sentiment.js 的關鍵字分析，使用者永遠拿得到結果。
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return RoboAdvisor.sentiment.fromScores(data.scores, responses);
  }

  async function analyze() {
    const responses = questions.map((q) => ({
      id: q.id,
      indicators: q.indicators,
      text: answers[q.id] || "",
    }));

    nextBtn2.disabled = true;
    backBtn2.disabled = true;
    nextBtn2.textContent = "分析中⋯";
    let results;
    try {
      results = await requestLlmAnalysis(responses);
    } catch (e) {
      results = RoboAdvisor.sentiment.analyze(responses);
    }
    backBtn2.disabled = false;
    nextBtn2.textContent = "查看完整評估結果";
    nextBtn2.disabled = false;

    saveResults(responses, results);
    showAllResults(results);
    submitToBackend();
  }

  /**
   * 把暱稱與兩階段結果送到後端記錄。失敗（例如直接開啟 index.html、
   * 沒有啟動後端）不影響結果頁，只在頁面上提示沒有記錄成功。
   */
  async function submitToBackend() {
    const nickname = RoboAdvisor.nickname.get();
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

  /**
   * 顯示完整結果：先把結果頁切出來，再請 app.js 畫第一階段那段
   * （投資人類型、基準風險分數、風險構面雷達圖），最後補上行為
   * 情緒指標的部分。
   *
   * 順序很重要：一定要先 remove("hidden") 再畫圖。Chart.js 在
   * display:none 的容器裡量不到寬高，畫出來的圖會是空白或變形；
   * 而且萬一畫圖出錯，結果頁也已經顯示出來了，不會整頁卡住。
   */
  function showAllResults(results) {
    wizard2El.classList.add("hidden");
    resultsEl.classList.remove("hidden");

    RoboAdvisor.phase1.renderResultsSection();
    renderPhase2Section(results);

    resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderPhase2Section(results) {
    dominantName2.textContent = results.dominant.dimension;
    lowSignalNote2.classList.toggle("hidden", !results.lowSignal);
    analysisSource2.textContent =
      results.source === "llm"
        ? "分析方式：AI 語意分析（每個指標附上依據原句與信心度）"
        : "分析方式：簡易關鍵字分析（AI 分析未啟用或暫時無法使用，結果僅供參考）";

    breakdownList2.innerHTML = "";
    results.breakdown.forEach((item) => {
      const li = document.createElement("li");
      li.className = "breakdown-item breakdown-item--indicator";
      li.innerHTML = `
        <span class="breakdown-item__label">${item.dimension}</span>
        <span class="breakdown-item__bar-track">
          <span class="breakdown-item__bar-fill" style="width:${(item.score / 5) * 100}%; background:${item.color}"></span>
        </span>
        <span class="breakdown-item__score">${item.score} / 5</span>
      `;
      if (item.evidence) {
        const note = document.createElement("span");
        note.className = "breakdown-item__evidence";
        // evidence 來自使用者回答與 LLM，一律用 textContent 避免注入 HTML
        note.textContent = `依據：「${item.evidence}」（信心度：${confidenceLabels[item.confidence] || "低"}）`;
        li.appendChild(note);
      }
      breakdownList2.appendChild(li);
    });

    alertsList2.innerHTML = "";
    results.alerts.forEach((alert) => {
      const li = document.createElement("li");
      li.className = "alert-item";
      li.innerHTML = `<p>${alert.text}</p>`;
      alertsList2.appendChild(li);
    });
    noAlertsNote2.classList.toggle("hidden", results.alerts.length > 0);

    RoboAdvisor.renderRadarChart("radarCanvas2", results.breakdown, results.dominant.color, "行為與情緒指標");
  }

  function saveResults(responses, results) {
    let profile = {};
    try {
      profile = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      profile = {};
    }
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

  /** 由第一階段做完後呼叫，接著顯示開放式問題。 */
  function start() {
    renderQuestion(currentIndex);
    wizard2El.classList.remove("hidden");
    wizard2El.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** 重新測驗時，由 app.js 呼叫，只清空資料、不負責切換畫面。 */
  function reset() {
    currentIndex = 0;
    answers = {};
    wizard2El.classList.add("hidden");
  }

  // ---- Event bindings ----
  nextBtn2.addEventListener("click", goNext);
  backBtn2.addEventListener("click", goBack);
  qAnswer2.addEventListener("input", updateNextEnabled);

  // ---- 給 app.js 使用 ----
  RoboAdvisor.phase2 = { start, reset };
})();
