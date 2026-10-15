/**
 * app.js
 * 串接題庫（questions.js）與計分邏輯（scoring.js），
 * 驅動第一階段（傳統風險評估）的問卷精靈。
 *
 * 流程上，第一階段做完「不會」馬上顯示結果，而是直接接到第二階段
 * 的開放式問題（app-phase2.js）；所有結果——投資人類型與行為情緒
 * 指標——統一等到開放式問題結束後，在同一頁一次呈現。
 * 這支檔案只負責算出並「畫出」第一階段那一段結果區塊，
 * 真正把結果頁顯示出來的時機由 app-phase2.js 決定。
 */

(function () {
  const questions = RoboAdvisor.questions.phase1;
  const STORAGE_KEY = "roboAdvisorProfile";

  let currentIndex = 0;
  let answers = {}; // { [questionId]: optionIndex }
  let latestResults = null;

  // ---- DOM references ----
  const wizardEl = document.getElementById("wizard");
  const resultsEl = document.getElementById("results");

  const progressFill = document.getElementById("progressFill");
  const progressLabel = document.getElementById("progressLabel");

  const qDimension = document.getElementById("qDimension");
  const qText = document.getElementById("qText");
  const qNote = document.getElementById("qNote");
  const qOptions = document.getElementById("qOptions");

  const backBtn = document.getElementById("backBtn");
  const nextBtn = document.getElementById("nextBtn");

  const typeName = document.getElementById("typeName");
  const scoreNumber = document.getElementById("scoreNumber");
  const typeDescription = document.getElementById("typeDescription");
  const capNotice = document.getElementById("capNotice");
  const capBefore = document.getElementById("capBefore");
  const capAfter = document.getElementById("capAfter");
  const capReasons = document.getElementById("capReasons");
  const breakdownList = document.getElementById("breakdownList");
  const retakeBtn = document.getElementById("retakeBtn");
  const downloadBtn = document.getElementById("downloadBtn");

  // ---- Rendering ----

  function renderQuestion(index) {
    const q = questions[index];

    progressFill.style.width = `${((index + 1) / questions.length) * 100}%`;
    progressLabel.textContent = `第 ${index + 1} 題，共 ${questions.length} 題`;

    qDimension.textContent = q.dimension;
    qText.textContent = q.question;
    qNote.textContent = q.note || "";
    qNote.classList.toggle("hidden", !q.note);

    qOptions.innerHTML = "";
    q.options.forEach((option, optionIndex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", answers[q.id] === optionIndex ? "true" : "false");
      if (answers[q.id] === optionIndex) btn.classList.add("is-selected");

      btn.innerHTML = `<span class="option__dot" aria-hidden="true"></span><span>${option.text}</span>`;
      btn.addEventListener("click", () => selectOption(q.id, optionIndex));
      qOptions.appendChild(btn);
    });

    backBtn.disabled = index === 0;
    backBtn.style.visibility = index === 0 ? "hidden" : "visible";

    const isLast = index === questions.length - 1;
    nextBtn.textContent = isLast ? "繼續：行為與情緒評估" : "下一題";
    nextBtn.disabled = answers[q.id] === undefined;
  }

  function selectOption(questionId, optionIndex) {
    answers[questionId] = optionIndex;
    renderQuestion(currentIndex);
  }

  function goNext() {
    const isLast = currentIndex === questions.length - 1;
    if (isLast) {
      finishPhase1();
      return;
    }
    currentIndex += 1;
    renderQuestion(currentIndex);
  }

  function goBack() {
    if (currentIndex === 0) return;
    currentIndex -= 1;
    renderQuestion(currentIndex);
  }

  /**
   * 第一階段做完：算分、存檔，然後直接把畫面交給第二階段的
   * 開放式問題；結果要等第二階段結束後才會一起顯示。
   */
  function finishPhase1() {
    latestResults = RoboAdvisor.scoring.computeResults(questions, answers);
    saveResults(latestResults);

    wizardEl.classList.add("hidden");
    RoboAdvisor.phase2.start();
  }

  /** 把第一階段的結果畫進共用結果頁（不負責顯示結果頁本身）。 */
  function renderResultsSection() {
    const results = latestResults;
    if (!results) return;

    typeName.textContent = results.type.name;
    scoreNumber.textContent = results.baselineScore;
    typeDescription.textContent = results.type.desc;

    // 類型被上限規則調降時，同時顯示調整前的類型與原因
    const adjusted = results.type !== results.rawType;
    capNotice.classList.toggle("hidden", !adjusted);
    capReasons.innerHTML = "";
    if (adjusted) {
      capBefore.textContent = results.rawType.name;
      capAfter.textContent = results.type.name;
      results.capReasons.forEach((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        capReasons.appendChild(li);
      });
    }

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
      `;
      breakdownList.appendChild(li);
    });

    RoboAdvisor.renderRadarChart("radarCanvas", results.breakdown, results.type.color, "傳統風險輪廓");
  }

  function saveResults(results) {
    let profile = {};
    try {
      profile = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      profile = {};
    }
    profile.phase1 = {
      answers,
      average: results.average,
      baselineScore: results.baselineScore,
      investorType: results.type.key,
      rawInvestorType: results.rawType.key,
      capacityAverage: results.capacityAverage,
      capReasons: results.capReasons,
      completedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  }

  /** 重新測驗：兩個階段一起從頭開始（先回到暱稱步驟）。 */
  function retake() {
    currentIndex = 0;
    answers = {};
    latestResults = null;
    RoboAdvisor.phase2.reset();

    resultsEl.classList.add("hidden");
    renderQuestion(0);
    RoboAdvisor.nickname.show();
  }

  function download() {
    const profile = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "robo-advisor-profile.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** 從第二階段第一題按「上一題」時，回到第一階段的最後一題。 */
  function showLastQuestion() {
    currentIndex = questions.length - 1;
    renderQuestion(currentIndex);
    wizardEl.classList.remove("hidden");
    wizardEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Event bindings ----
  nextBtn.addEventListener("click", goNext);
  backBtn.addEventListener("click", goBack);
  retakeBtn.addEventListener("click", retake);
  downloadBtn.addEventListener("click", download);

  // ---- 給 app-phase2.js 使用 ----
  RoboAdvisor.phase1 = {
    renderResultsSection,
    showLastQuestion,
  };

  // ---- Init ----
  renderQuestion(currentIndex);
})();
