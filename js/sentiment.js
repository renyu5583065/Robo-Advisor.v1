/**
 * sentiment.js
 * 
 * 【功能說明】
 * 第二階段開放式問答的情緒與行為財務學分析引擎：
 * 將使用者的自由文字回答，分析量化為七大行為與情緒心理指標：
 * 1. 焦慮 (Anxiety)
 * 2. 損失規避 (Loss Aversion)
 * 3. 自信程度 (Confidence)
 * 4. 從眾傾向 (Herding)
 * 5. 過度自信 (Overconfidence)
 * 6. 確認偏誤 (Confirmation Bias)
 * 7. 處置效應 (Disposition Effect)
 * 
 * 【雙軌分析架構】
 * 1. 本地關鍵字比對（analyze）：當無後端或離線時，透過中英文特徵關鍵字快速計算 1–5 分。
 * 2. LLM 語意分析轉換（fromScores）：當後端連線正常時，接收伺服器端大型語言模型給出的分數、
 *    引證依據（evidence）與信心度（confidence），格式化為標準結果。
 * 3. 行為偏誤警示系統（buildAlerts）：若特定指標分數過高，自動觸發理財行為警示與避坑建議。
 */

// 確保全域命名空間物件 RoboAdvisor 存在（若尚未建立則初始化為空物件）
window.RoboAdvisor = window.RoboAdvisor || {};

RoboAdvisor.sentiment = {
  // 1. 行為情緒七大指標字典 (Indicators & Keyword Dictionary)
  // 定義指標名稱、主題代表顏色，以及調升/調降分數的中英關鍵字清單
  indicators: [
    {
      key: "anxiety",
      name: "焦慮",
      color: "#d4556f",
      // 出現以下詞彙時，調升焦慮分數（代表情緒波動大、市場下跌時容易恐慌）
      raise: [
        "焦慮", "緊張", "擔心", "害怕", "恐慌", "睡不著", "壓力大", "不安", "很怕",
        "worried", "anxious", "nervous", "scared", "panic", "stressed", "afraid",
        "can't sleep", "freak out", "terrified",
      ],
      // 出現以下詞彙時，調降焦慮分數（代表情緒沉著穩定）
      calm: [
        "冷靜", "平靜", "不擔心", "淡定", "沒差", "不緊張", "安心",
        "calm", "relaxed", "fine", "not worried", "unbothered", "at ease", "peace of mind",
      ],
    },
    {
      key: "lossAversion",
      name: "損失規避",
      color: "#f29a76",
      // 出現以下詞彙時，調升損失規避分數（對虧損極度敏感，傾向立刻停損或恐慌性拋售）
      raise: [
        "賣掉", "全部賣", "停損", "立刻賣", "不能接受虧損", "受不了", "趕快出場", "認賠",
        "sell everything", "sell all", "sell it all", "cut my losses", "cut losses",
        "stop loss", "can't tolerate", "get out", "panic sell", "pull out",
      ],
      // 出現以下詞彙時，調降損失規避分數（願意長期抗戰或逢低加碼）
      calm: [
        "繼續持有", "長期投資", "不受影響", "加碼", "逢低買進", "不會賣",
        "hold", "stay invested", "buy more", "long term", "ride it out",
        "doesn't bother me", "not sell", "keep holding",
      ],
    },
    {
      key: "confidence",
      name: "自信程度",
      color: "#3db7c4",
      // 出現以下詞彙時，調升自信分數（清楚自身策略並信任自我規劃）
      raise: [
        "有信心", "相信自己的判斷", "做過研究", "了解市場", "按計畫執行", "很確定", "很有把握",
        "confident", "trust my plan", "done my research", "i know what i'm doing",
        "sticking to my strategy", "sure about", "i've got this",
      ],
      // 出現以下詞彙時，調降自信分數（對決策感到迷惘或猶豫不決）
      calm: [
        "不知道", "不確定", "不懂", "沒把握", "猶豫", "不太清楚", "很迷惘",
        "don't know", "unsure", "not sure", "no idea", "confused", "hesitant", "uncertain",
      ],
    },
    {
      key: "herding",
      name: "從眾傾向",
      color: "#b565a7",
      // 出現以下詞彙時，調升從眾分數（容易受到社群或他人影響而跟風進場）
      raise: [
        "跟著大家", "跟風", "別人都在", "朋友說", "大家都買", "跟進", "也跟著買",
        "follow the crowd", "everyone else is", "my friend", "jump in too",
        "do what others do", "fomo", "chase the trend", "copy",
      ],
      // 出現以下詞彙時，調降從眾分數（堅持獨立判斷、不盲目隨波逐流）
      calm: [
        "自己的計畫", "不受他人影響", "堅持原則", "不會跟風", "維持原策略",
        "stick to my own plan", "ignore others", "not influenced", "my own strategy",
        "don't care what others",
      ],
    },
    {
      key: "overconfidence",
      name: "過度自信",
      color: "#8e7cc3",
      // 出現以下詞彙時，調升過度自信分數（高估自身預測能力、認為穩賺不賠或傾向融資全押）
      raise: [
        "一定會賺", "穩賺", "比別人厲害", "不需要多想", "我看得很準", "絕對沒問題", "全押",
        "guaranteed", "sure thing", "definitely will", "better than others",
        "i'm always right", "no need to think twice", "time the market", "all in",
      ],
      // 出現以下詞彙時，調降過度自信分數（保持謙遜、認知到市場不確定性與風險）
      calm: [
        "有風險", "可能會錯", "需要謹慎", "分散風險", "量力而為",
        "there's risk", "might be wrong", "could lose", "need to be careful", "diversify",
      ],
    },
    {
      key: "confirmationBias",
      name: "確認偏誤",
      color: "#1f8e9b",
      // 出現以下詞彙時，調升確認偏誤分數（只願意尋找符合自己看法的資訊，忽視反向警訊）
      raise: [
        "不會理會", "不值一提", "只相信自己", "博眼球", "亂猜", "找支持", "支持我看多", "證明自己是對的", "證明自己的看法", "只看看多", "不想聽",
        "ignore the bears", "only trust my own", "agree with me", "prove i'm right", "clickbait",
        "dismiss", "don't care what analysts",
      ],
      // 出現以下詞彙時，調降確認偏誤分數（具備批判性思維，願意兼聽反方觀點）
      calm: [
        "反方觀點", "仔細閱讀", "認真檢視", "願意認錯", "盲點", "另一面", "不同意見", "修正操作",
        "opposing view", "consider the other side", "blind spot", "admit i'm wrong",
        "change my mind", "reconsider", "open to criticism",
      ],
    },
    {
      key: "dispositionEffect",
      name: "處置效應",
      color: "#ef8197",
      // 出現以下詞彙時，調升處置效應分數（虧損時捨不得賣、執著於「沒賣就不算賠」或「等解套」）
      raise: [
        "沒賣就不算賠", "抱到回本", "等回本", "捨不得賣", "不甘心", "不想面對", "解套", "擺著不管",
        "not a loss until i sell", "wait until i break even", "hold until it recovers",
        "get back to even", "can't bring myself to sell", "refuse to sell at a loss",
      ],
      // 出現以下詞彙時，調降處置效應分數（理解沉沒成本概念，以基本面為停損停利依據）
      calm: [
        "不會糾結", "不糾結", "買進成本不重要", "理由不存在", "分批退場", "基本面變質", "換股",
        "sunk cost", "doesn't matter what i paid", "thesis is broken", "reassess the fundamentals",
        "exit if the reason is gone",
      ],
    },
  ],

  // 2. 本地端關鍵字比對分析 (Local Keyword Analysis Engine)
  /**
   * 純前端關鍵字比對引擎：整合所有回答文字並比對詞庫計算各指標得分
   * @param {Array<Object>} responses - 使用者的所有回答資料陣列，格式為 [{ id, indicators, text }, ...]
   * @returns {Object} 包含各指標得分、最顯著指標、警示提醒與線索狀態的結果物件
   */
  analyze(responses) {
    // 將所有題目的回答文字合併為一個大字串，並轉為小寫以便進行不分大小寫比對
    const combined = responses
      .map((r) => (r.text || "").trim())
      .join(" \n ")
      .toLowerCase();

    // 逐一計算七大指標的得分
    const breakdown = this.indicators.map((indicator) => {
      const raiseHits = countHits(combined, indicator.raise); // 命中調升關鍵字次數
      const calmHits = countHits(combined, indicator.calm);   // 命中調降關鍵字次數

      // 計分模型設計：
      // - 預設基準分為 3 分（中立態度）
      // - 命中 raise 關鍵字每次加 0.8 分（最多採計 3 次，即最高 +2.4 分）
      // - 命中 calm 關鍵字每次扣 0.8 分（最多採計 3 次，即最多 -2.4 分）
      const raw = 3 + 0.8 * Math.min(raiseHits, 3) - 0.8 * Math.min(calmHits, 3);
      // 四捨五入並限制在 1 到 5 分的合理量表區間內
      const score = clamp(Math.round(raw), 1, 5);

      return {
        key: indicator.key,
        dimension: indicator.name,
        score,
        color: indicator.color,
        matched: raiseHits + calmHits > 0, // 標記此指標是否有比對到任何關鍵字
      };
    });

    // 計算使用者總共輸入的純文字字元數
    const totalTextLength = responses.reduce((sum, r) => sum + (r.text || "").trim().length, 0);
    // 檢查是否有命中任何關鍵字
    const anyMatched = breakdown.some((item) => item.matched);
    // 判斷是否為「低訊號（線索不足）」：回答總字數小於 40 字或完全沒命中任何關鍵字
    const lowSignal = totalTextLength < 40 || !anyMatched;

    return { ...finalize(breakdown), lowSignal, source: "keyword" };
  },

  // 3. 後端 LLM 結果轉換 (LLM Response Adapter)
  /**
   * 接收後端大型語言模型 (LLM) 回傳的語意分析結果，轉換為與本地引擎相同的標準輸出格式
   * 每個指標會額外附帶 evidence（依據原句引文）與 confidence（AI 信心度）
   * @param {Object} scores - 後端回傳的分數字典，格式為 { [key]: { score, evidence, confidence } }
   * @param {Array<Object>} responses - 使用者的原始回答資料，用以判斷文字長度是否過短
   * @returns {Object} 格式化後的完整評估結果
   */
  fromScores(scores, responses) {
    const breakdown = this.indicators.map((indicator) => {
      const item = scores[indicator.key];
      return {
        key: indicator.key,
        dimension: indicator.name,
        score: item.score,
        color: indicator.color,
        evidence: item.evidence,     // AI 從回答中摘錄的依據語句
        confidence: item.confidence, // AI 判讀該指標的信心度等級 ("high", "medium", "low")
      };
    });

    const totalTextLength = responses.reduce((sum, r) => sum + (r.text || "").trim().length, 0);
    // 若文字總長小於 40 字，或所有指標的信心度皆為 "low"，標記為低訊號
    const lowSignal = totalTextLength < 40 || breakdown.every((item) => item.confidence === "low");

    return { ...finalize(breakdown), lowSignal, source: "llm" };
  },
};

// 4. 統計收斂與共用輔助函式 (Finalization & Helpers)

/**
 * 整合結果：找出分數最高的顯著指標，並生成行為警示
 * @param {Array<Object>} breakdown - 七大指標的得分細項陣列
 * @returns {{ breakdown: Array, dominant: Object, alerts: Array }}
 */
function finalize(breakdown) {
  // 找出分數最高的指標項目作為最主要的顯著心理特徵 (Dominant Trait)
  const dominant = breakdown.reduce((max, item) => (item.score > max.score ? item : max), breakdown[0]);
  return { breakdown, dominant, alerts: buildAlerts(breakdown) };
}

/**
 * 計算指定關鍵字清單在文本中出現的次數
 * @param {string} text - 待搜尋的全文（已轉小寫）
 * @param {Array<string>} keywords - 欲匹配的關鍵字字串陣列
 * @returns {number} 匹配命中的總次數
 */
function countHits(text, keywords) {
  let hits = 0;
  keywords.forEach((keyword) => {
    // 檢查文本是否包含該關鍵字（關鍵字也確保轉為小寫）
    if (text.includes(keyword.toLowerCase())) hits += 1;
  });
  return hits;
}

/**
 * 數值範圍限制器：將數值限制在 [min, max] 之間
 * @param {number} value - 待限制的數值
 * @param {number} min - 下界最小值
 * @param {number} max - 上界最大值
 * @returns {number} 限制後的數值
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 從 breakdown 陣列中依照指標 key 查找對應的指標資料物件
 * @param {Array<Object>} breakdown - 指標細項陣列
 * @param {string} key - 指標識別碼（例如 "anxiety"）
 * @returns {Object|undefined} 匹配的指標物件
 */
function byKey(breakdown, key) {
  return breakdown.find((item) => item.key === key);
}

// 5. 行為財務偏誤警示產生 (Behavioral Bias Alerts)

/**
 * 依據各項指標分數的高低組合，產生量身打造的投資行為盲點提醒與風險警示
 * @param {Array<Object>} breakdown - 指標得分細項陣列
 * @returns {Array<Object>} 警示訊息物件陣列，格式為 [{ text: "說明文字" }, ...]
 */
function buildAlerts(breakdown) {
  // 取出各項指標的得分 (1~5)
  const anxiety = byKey(breakdown, "anxiety").score;
  const lossAversion = byKey(breakdown, "lossAversion").score;
  const confidence = byKey(breakdown, "confidence").score;
  const herding = byKey(breakdown, "herding").score;
  const overconfidence = byKey(breakdown, "overconfidence").score;
  const confirmationBias = byKey(breakdown, "confirmationBias").score;
  const dispositionEffect = byKey(breakdown, "dispositionEffect").score;

  const alerts = [];

  // 警示 1：情緒反應劇烈（高焦慮 + 高損失規避）
  // 容易在市場回檔恐慌時做出非理性的殺跌割肉決定
  if (anxiety >= 4 && lossAversion >= 4) {
    alerts.push({
      text: "情緒反應偏高：焦慮與損失規避程度都偏高，市場下跌時可能會急於出場。建議在做決定前，先安排一段冷靜期或與顧問討論。",
    });
  }

  // 警示 2：從眾效應或過度自信（高從眾 或 高過度自信）
  // 容易受 FOMO 心理影響追高買進熱門飆股，或自認比市場聰明而輕忽下檔風險
  if (herding >= 4 || overconfidence >= 4) {
    alerts.push({
      text: "從眾或過度自信訊號：可能因為看到他人報酬而跟風進場，或低估風險。建議重新檢視分散配置與合理的報酬期待。",
    });
  }

  // 警示 3：確認偏誤（高確認偏誤）
  // 傾向只看符合自己看法的樂觀言論，自動濾除警告與反面證據
  if (confirmationBias >= 4) {
    alerts.push({
      text: "確認偏誤訊號：傾向忽略或貶低與自己看法相左的資訊。建議投資前主動閱讀反方觀點，並事先寫下「什麼情況代表我看錯了」。",
    });
  }

  // 警示 4：處置效應（高處置效應）
  // 抱著虧損的股票不放，心存「沒賣就不算賠」或「等解套」，造成資金長期卡死在劣質資產
  if (dispositionEffect >= 4) {
    alerts.push({
      text: "處置效應訊號：傾向抱著虧損的部位等回本。建議事先設定停損或再平衡規則，以買進理由是否仍成立（而非買進成本）作為去留的依據。",
    });
  }

  // 警示 5：信心不足且伴隨焦慮（低自信 + 中高焦慮）
  // 面對市場波動容易手足無措，需要更多金融教育引導與穩健投資配置
  if (confidence <= 2 && anxiety >= 3) {
    alerts.push({
      text: "信心不足並伴隨較高焦慮——在承擔更多風險之前，可能需要更多投資教育與陪伴說明。",
    });
  }

  return alerts;
}
