/**
 * scoring.js
 * 
 * 【功能說明】
 * 第一階段（傳統風險評估問卷）計分與投資人類型判定：
 * 1. 計算加權平均分數：將各題目 1–5 分的分數依照權重進行加權平均。
 * 2. 基準風險分數換算：將 1–5 分線性正規化映射至 0–100 分。
 * 3. 投資人類型判定：依分數區間初判為保守型、穩健型或積極型。
 * 4. 風險上限防護機制：
 *    - 依據客觀財務能力設定上限，防止主觀意願高但客觀賠不起的情況。
 *    - 單題致命條件硬性上限（如投資期限極短），防止高風險偏好被其他題的高分稀釋。
 */

// 確保全域命名空間物件 RoboAdvisor 存在（若尚未建立則初始化為空物件）
window.RoboAdvisor = window.RoboAdvisor || {};

// 計分模組定義
RoboAdvisor.scoring = {
  // 1. 投資人類型定義清單 (Investor Types Definition)
  // 分數劃分採左閉右開區間，average < max
  investorTypes: [
    {
      key: "conservative",
      max: 2.34, // 加權平均小於 2.34 分屬於保守型
      color: "#c94467",
      name: "保守型",
      desc: "您優先考慮保護本金，而非追求高成長。現金與高品質債券比重較高、股票波動較低的投資組合，較符合您的舒適度與能力。",
    },
    {
      key: "moderate",
      max: 3.68, // 加權平均介於 2.34 至 3.68 分之間屬於穩健型
      color: "#c94467",
      name: "穩健型",
      desc: "您能接受在成長與穩定間取得平衡。股債均衡配置、穩健成長並控制下檔風險的投資組合，較符合您的目標。",
    },
    {
      key: "aggressive",
      max: 5.01, // 加權平均大於等於 3.68 分（最高 5 分）屬於積極型
      color: "#c94467",
      name: "積極型",
      desc: "您著重長期成長，並能承受較大的短期波動。股票比重較高的投資組合，較符合您的目標與能力。",
    },
  ],

  // 2. 輔助函式：依平均分數查詢對應類型
  /**
   * 根據給定的平均分數查詢所屬的投資人類型
   * @param {number} average - 1 到 5 之間的加權平均分數
   * @returns {Object} 對應的投資人類型物件
   */
  typeForAverage(average) {
    // 依序尋找第一個平均分數小於 max 的類型
    return (
      this.investorTypes.find((t) => average < t.max) ||
      this.investorTypes[this.investorTypes.length - 1] // 若皆未命中則預設為最後一型（積極型）
    );
  },

  // 3. 核心計分演算法 (Main Computation)
  /**
   * 綜合運算問卷結果
   * @param {Array<Object>} questions - 第一階段題目題庫（RoboAdvisor.questions.phase1）
   * @param {Object} answers - 使用者各題作答記錄，格式為 { [questionId]: optionIndex }
   * @returns {Object} 包含構面得分、加權平均、基準分數、原始類型、最終類型與上限原因的結果物件
   */
  computeResults(questions, answers) {
    // 整理每一題的構面、所選選項與對應得分明細
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

    /**
     * 計算題目子集的加權平均分數
     * 公式：加權平均 = Σ(得分 × 權重) / Σ(權重)
     * @param {Array<Object>} items - 欲計算加權平均的題目細項陣列
     * @returns {number} 加權平均值（四捨五入至小數點後兩位）
     */
    const weightedAverage = (items) => {
      // 取得題目設定的權重（若未設定則預設權重為 1）
      const w = (item) => questions.find((q) => q.id === item.id).weight ?? 1;
      const totalWeight = items.reduce((sum, item) => sum + w(item), 0);
      const sum = items.reduce((acc, item) => acc + item.score * w(item), 0);
      // 先四捨五入到小數點後兩位，避免浮點數精度微小誤差造成分界判定錯誤
      return Math.round((sum / totalWeight) * 100) / 100;
    };

    // 計算全部題目的整體加權平均
    const average = weightedAverage(breakdown);

    // 計算專屬「客觀承受能力組（capacity）」的加權平均分數
    // 例如：年齡、年收入、可投資資產、投資期限、提款需求等題型
    const capacityAverage = weightedAverage(
      breakdown.filter((item) => questions.find((q) => q.id === item.id).group === "capacity")
    );

    // 換算基準風險分數：將 1–5 分正規化為 0–100 分整數
    // 公式：((分數 - 最小值) / (最大值 - 最小值)) * 100
    const baselineScore = Math.round(((average - 1) / 4) * 100);

    // 4. 風險上限防護機制 (Capping Rules & Investor Suitability)
    // 金融適合度原則：當投資人的意願（主觀承受力）高於能力（客觀承受力）時，應強制降級保護客戶
    const rank = (type) => this.investorTypes.indexOf(type); // 取得保守到積極的等級序號 (0: 保守, 1: 穩健, 2: 積極)
    const rawType = this.typeForAverage(average);             // 尚未套用上限前的原始整體類型
    const capReasons = [];                                   // 記錄觸發降級的原因文字清單
    let finalType = rawType;                                 // 最終評定類型，預設為原始類型

    /**
     * 嘗試套用上限規則：若上限類型比當前結果更保守，則將類型調降至該上限
     * @param {Object} capType - 上限所允許的最高投資人類型
     * @param {string} reason - 觸發該上限的原因說明文字
     */
    const applyCap = (capType, reason) => {
      // 若上限等級大於等於原始等級，代表原本就比上限更保守，無需調整
      if (rank(capType) >= rank(rawType)) return;
      capReasons.push(reason);
      // 若上限類型比目前暫存的 finalType 更嚴格（更保守），則更新 finalType
      if (rank(capType) < rank(finalType)) {
        finalType = capType;
      }
    };

    // 規則一：客觀能力上限——整體風格不能比客觀承受能力更積極
    const capacityType = this.typeForAverage(capacityAverage);
    applyCap(
      capacityType,
      `客觀承受能力（年齡、收入、資產、投資期限、提款需求、損失承受能力）的加權平均為 ${capacityAverage} 分，屬於${capacityType.name}。`
    );

    // 規則二：單題硬性上限（Hard Cap）——致命條件不能被其他題的高分稀釋
    // 例如：投資期限小於 1 年或近期必須提款，即使其他題全拿 5 分也不能給積極型
    questions.forEach((q, i) => {
      if (!q.hardCap || breakdown[i].score > q.hardCap.triggerScore) return;
      const capType = this.investorTypes.find((t) => t.key === q.hardCap.maxType);
      applyCap(capType, `「${q.dimension}」：${q.hardCap.reason}，類型最高為${capType.name}。`);
    });

    // 回傳完整計算結果封裝物件
    return {
      breakdown,       // 各題回答與得分明細
      average,         // 整體加權平均分數 (1~5)
      baselineScore,   // 基準風險分數 (0~100)
      rawType,         // 降級前的原始類型
      type: finalType, // 經過上限檢核後的最終類型
      capacityAverage, // 客觀承受能力構面平均分數
      capReasons,      // 觸發調降的原因文字清單
    };
  },
};
