/**
 * scoring.js
 * 把第一階段的作答換算成基準風險分數與 Investor Type。
 *
 * 每題都是 1–5 分，再依各題的 weight（見 questions.js）加權平均，
 * 所以不管題數多少，加權平均分數都落在 1–5 的量表上。這個分數
 * 決定 Investor Type，也換算成 0–100 分，做為版面上的
 * 「基準風險分數」，兩者出自同一個加權平均，不會互相矛盾。
 */

window.RoboAdvisor = window.RoboAdvisor || {};

RoboAdvisor.scoring = {
  investorTypes: [
    {
      key: "conservative",
      max: 2.34, // 平均分數小於這個值（不含）
      color: "#3db7c4",
      name: "保守型",
      desc: "您優先考慮保護本金，而非追求高成長。現金與高品質債券比重較高、股票波動較低的投資組合，較符合您的舒適度與能力。",
    },
    {
      key: "moderate",
      max: 3.68,
      color: "#ef8197",
      name: "穩健型",
      desc: "您能接受在成長與穩定間取得平衡。股債均衡配置、穩健成長並控制下檔風險的投資組合，較符合您的目標。",
    },
    {
      key: "aggressive",
      max: 5.01,
      color: "#c94467",
      name: "積極型",
      desc: "您著重長期成長，並能承受較大的短期波動。股票比重較高的投資組合，較符合您的目標與能力。",
    },
  ],

  /** 平均分數對應的投資人類型（區間為左閉右開，剛好等於門檻時歸入較積極的一型）。 */
  typeForAverage(average) {
    return (
      this.investorTypes.find((t) => average < t.max) ||
      this.investorTypes[this.investorTypes.length - 1]
    );
  },

  /**
   * @param {Array} questions  RoboAdvisor.questions.phase1
   * @param {Object} answers   { [questionId]: optionIndex }
   * @returns {Object} {
   *   breakdown, average（加權平均）, baselineScore,
   *   rawType（套用上限前）, type（最終）, capacityAverage, capReasons
   * }
   */
  computeResults(questions, answers) {
    const breakdown = questions.map((q) => {
      const optionIndex = answers[q.id];
      const option = q.options[optionIndex];
      return {
        id: q.id,
        dimension: q.dimension,
        answer: option,
        score: option.score,
      };
    });

    const weightedAverage = (items) => {
      const w = (item) => questions.find((q) => q.id === item.id).weight ?? 1;
      const totalWeight = items.reduce((sum, item) => sum + w(item), 0);
      const sum = items.reduce((acc, item) => acc + item.score * w(item), 0);
      // 先四捨五入到小數兩位，避免浮點誤差讓剛好等於門檻的分數落到另一邊
      return Math.round((sum / totalWeight) * 100) / 100;
    };

    const average = weightedAverage(breakdown);
    const capacityAverage = weightedAverage(
      breakdown.filter((item) => questions.find((q) => q.id === item.id).group === "capacity")
    );

    // 把 1–5 分的加權平均，換算成較直覺的 0–100 分「基準風險分數」
    const baselineScore = Math.round(((average - 1) / 4) * 100);

    // ---- 類型與上限：最終類型取「整體類型」與所有上限中最保守的一個 ----
    const rank = (type) => this.investorTypes.indexOf(type);
    const rawType = this.typeForAverage(average);
    const capReasons = [];
    let finalType = rawType;

    const applyCap = (capType, reason) => {
      if (rank(capType) >= rank(rawType)) return; // 沒有比原本更保守，不算調整
      capReasons.push(reason);
      if (rank(capType) < rank(finalType)) finalType = capType;
    };

    // 規則一：能力構面上限——整體類型不能比客觀承受能力更積極
    const capacityType = this.typeForAverage(capacityAverage);
    applyCap(
      capacityType,
      `客觀承受能力（年齡、收入、資產、投資期限、提款需求、損失承受能力）的加權平均為 ${capacityAverage} 分，屬於${capacityType.name}。`
    );

    // 規則二：單題硬性上限——致命條件不能被其他題的高分稀釋
    questions.forEach((q, i) => {
      if (!q.hardCap || breakdown[i].score > q.hardCap.triggerScore) return;
      const capType = this.investorTypes.find((t) => t.key === q.hardCap.maxType);
      applyCap(capType, `「${q.dimension}」：${q.hardCap.reason}，類型最高為${capType.name}。`);
    });

    return {
      breakdown,
      average,
      baselineScore,
      rawType,
      type: finalType,
      capacityAverage,
      capReasons,
    };
  },
};
