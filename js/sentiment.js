/**
 * sentiment.js
 * 把第二階段的開放式文字回答，轉換成七個行為 / 情緒指標的分數：
 * 焦慮、損失規避、自信程度、從眾傾向、過度自信、確認偏誤、處置效應。
 *
 * 這是一個輕量、純前端的關鍵字比對引擎，用來代替課程投影片裡
 * 「Sentiment Analysis（LLM／NLP）」的步驟。這個專案是純靜態網站，
 * 沒有後端或 API 金鑰可以安全地呼叫真正的語言模型，所以先用關鍵字
 * 規則做一個誠實、可運作的替代方案；回傳的資料結構跟 scoring.js
 * 一樣是 { dimension, score } 陣列，之後如果要換成呼叫真正的 LLM／
 * NLP API，理論上只需要替換這支檔案的 analyze() 實作即可。
 *
 * 關鍵字比對同時保留中、英文兩種寫法，這樣不管測試人員用中文或
 * 英文作答都能被偵測到；畫面上顯示的指標名稱與提醒文字則統一用
 * 中文，符合這個網站以中文為主的設計。
 */

window.RoboAdvisor = window.RoboAdvisor || {};

RoboAdvisor.sentiment = {
  indicators: [
    {
      key: "anxiety",
      name: "焦慮",
      color: "#c94f4f",
      raise: [
        "焦慮", "緊張", "擔心", "害怕", "恐慌", "睡不著", "壓力大", "不安", "很怕",
        "worried", "anxious", "nervous", "scared", "panic", "stressed", "afraid",
        "can't sleep", "freak out", "terrified",
      ],
      calm: [
        "冷靜", "平靜", "不擔心", "淡定", "沒差", "不緊張", "安心",
        "calm", "relaxed", "fine", "not worried", "unbothered", "at ease", "peace of mind",
      ],
    },
    {
      key: "lossAversion",
      name: "損失規避",
      color: "#5b6fc9",
      raise: [
        "賣掉", "全部賣", "停損", "立刻賣", "不能接受虧損", "受不了", "趕快出場", "認賠",
        "sell everything", "sell all", "sell it all", "cut my losses", "cut losses",
        "stop loss", "can't tolerate", "get out", "panic sell", "pull out",
      ],
      calm: [
        "繼續持有", "長期投資", "不受影響", "加碼", "逢低買進", "不會賣",
        "hold", "stay invested", "buy more", "long term", "ride it out",
        "doesn't bother me", "not sell", "keep holding",
      ],
    },
    {
      key: "confidence",
      name: "自信程度",
      color: "#14b8a6",
      raise: [
        "有信心", "相信自己的判斷", "做過研究", "了解市場", "按計畫執行", "很確定", "很有把握",
        "confident", "trust my plan", "done my research", "i know what i'm doing",
        "sticking to my strategy", "sure about", "i've got this",
      ],
      calm: [
        "不知道", "不確定", "不懂", "沒把握", "猶豫", "不太清楚", "很迷惘",
        "don't know", "unsure", "not sure", "no idea", "confused", "hesitant", "uncertain",
      ],
    },
    {
      key: "herding",
      name: "從眾傾向",
      color: "#c97c13",
      raise: [
        "跟著大家", "跟風", "別人都在", "朋友說", "大家都買", "跟進", "也跟著買",
        "follow the crowd", "everyone else is", "my friend", "jump in too",
        "do what others do", "fomo", "chase the trend", "copy",
      ],
      calm: [
        "自己的計畫", "不受他人影響", "堅持原則", "不會跟風", "維持原策略",
        "stick to my own plan", "ignore others", "not influenced", "my own strategy",
        "don't care what others",
      ],
    },
    {
      key: "overconfidence",
      name: "過度自信",
      color: "#8a4fc9",
      raise: [
        "一定會賺", "穩賺", "比別人厲害", "不需要多想", "我看得很準", "絕對沒問題", "全押",
        "guaranteed", "sure thing", "definitely will", "better than others",
        "i'm always right", "no need to think twice", "time the market", "all in",
      ],
      calm: [
        "有風險", "可能會錯", "需要謹慎", "分散風險", "量力而為",
        "there's risk", "might be wrong", "could lose", "need to be careful", "diversify",
      ],
    },
    {
      key: "confirmationBias",
      name: "確認偏誤",
      color: "#d1578a",
      raise: [
        "不會理會", "不值一提", "只相信自己", "博眼球", "亂猜", "找支持", "支持我看多", "證明自己是對的", "證明自己的看法", "只看看多", "不想聽",
        "ignore the bears", "only trust my own", "agree with me", "prove i'm right", "clickbait",
        "dismiss", "don't care what analysts",
      ],
      calm: [
        "反方觀點", "仔細閱讀", "認真檢視", "願意認錯", "盲點", "另一面", "不同意見", "修正操作",
        "opposing view", "consider the other side", "blind spot", "admit i'm wrong",
        "change my mind", "reconsider", "open to criticism",
      ],
    },
    {
      key: "dispositionEffect",
      name: "處置效應",
      color: "#5a8f3d",
      raise: [
        "沒賣就不算賠", "抱到回本", "等回本", "捨不得賣", "不甘心", "不想面對", "解套", "擺著不管",
        "not a loss until i sell", "wait until i break even", "hold until it recovers",
        "get back to even", "can't bring myself to sell", "refuse to sell at a loss",
      ],
      calm: [
        "不會糾結", "不糾結", "買進成本不重要", "理由不存在", "分批退場", "基本面變質", "換股",
        "sunk cost", "doesn't matter what i paid", "thesis is broken", "reassess the fundamentals",
        "exit if the reason is gone",
      ],
    },
  ],

  /**
   * @param {Array} responses  [{ id, indicators, text }]
   * @returns {Object} { breakdown, dominant, alerts, lowSignal }
   */
  analyze(responses) {
    const combined = responses
      .map((r) => (r.text || "").trim())
      .join(" \n ")
      .toLowerCase();

    const breakdown = this.indicators.map((indicator) => {
      const raiseHits = countHits(combined, indicator.raise);
      const calmHits = countHits(combined, indicator.calm);
      const raw = 3 + 0.8 * Math.min(raiseHits, 3) - 0.8 * Math.min(calmHits, 3);
      const score = clamp(Math.round(raw), 1, 5);
      return {
        key: indicator.key,
        dimension: indicator.name,
        score,
        color: indicator.color,
        matched: raiseHits + calmHits > 0,
      };
    });

    const totalTextLength = responses.reduce((sum, r) => sum + (r.text || "").trim().length, 0);
    const anyMatched = breakdown.some((item) => item.matched);
    const lowSignal = totalTextLength < 40 || !anyMatched;

    return { ...finalize(breakdown), lowSignal, source: "keyword" };
  },

  /**
   * 用 LLM 給的分數（見 server/llm.js）組出跟 analyze() 相同結構的結果，
   * 另外每個指標會帶 evidence（依據原句）與 confidence。
   * @param {Object} scores  { [key]: { score, evidence, confidence } }
   * @param {Array} responses  同 analyze() 的輸入，用來判斷回答是否太短
   */
  fromScores(scores, responses) {
    const breakdown = this.indicators.map((indicator) => {
      const item = scores[indicator.key];
      return {
        key: indicator.key,
        dimension: indicator.name,
        score: item.score,
        color: indicator.color,
        evidence: item.evidence,
        confidence: item.confidence,
      };
    });
    const totalTextLength = responses.reduce((sum, r) => sum + (r.text || "").trim().length, 0);
    const lowSignal = totalTextLength < 40 || breakdown.every((item) => item.confidence === "low");
    return { ...finalize(breakdown), lowSignal, source: "llm" };
  },
};

/** 兩種分析來源共用：找出主要訊號、產生提醒。 */
function finalize(breakdown) {
  const dominant = breakdown.reduce((max, item) => (item.score > max.score ? item : max), breakdown[0]);
  return { breakdown, dominant, alerts: buildAlerts(breakdown) };
}

function countHits(text, keywords) {
  let hits = 0;
  keywords.forEach((keyword) => {
    if (text.includes(keyword.toLowerCase())) hits += 1;
  });
  return hits;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function byKey(breakdown, key) {
  return breakdown.find((item) => item.key === key);
}

function buildAlerts(breakdown) {
  const anxiety = byKey(breakdown, "anxiety").score;
  const lossAversion = byKey(breakdown, "lossAversion").score;
  const confidence = byKey(breakdown, "confidence").score;
  const herding = byKey(breakdown, "herding").score;
  const overconfidence = byKey(breakdown, "overconfidence").score;
  const confirmationBias = byKey(breakdown, "confirmationBias").score;
  const dispositionEffect = byKey(breakdown, "dispositionEffect").score;

  const alerts = [];

  if (anxiety >= 4 && lossAversion >= 4) {
    alerts.push({
      text: "情緒反應偏高：焦慮與損失規避程度都偏高，市場下跌時可能會急於出場。建議在做決定前，先安排一段冷靜期或與顧問討論。",
    });
  }

  if (herding >= 4 || overconfidence >= 4) {
    alerts.push({
      text: "從眾或過度自信訊號：可能因為看到他人報酬而跟風進場，或低估風險。建議重新檢視分散配置與合理的報酬期待。",
    });
  }

  if (confirmationBias >= 4) {
    alerts.push({
      text: "確認偏誤訊號：傾向忽略或貶低與自己看法相左的資訊。建議投資前主動閱讀反方觀點，並事先寫下「什麼情況代表我看錯了」。",
    });
  }

  if (dispositionEffect >= 4) {
    alerts.push({
      text: "處置效應訊號：傾向抱著虧損的部位等回本。建議事先設定停損或再平衡規則，以買進理由是否仍成立（而非買進成本）作為去留的依據。",
    });
  }

  if (confidence <= 2 && anxiety >= 3) {
    alerts.push({
      text: "信心不足並伴隨較高焦慮——在承擔更多風險之前，可能需要更多投資教育與陪伴說明。",
    });
  }

  return alerts;
}
