/**
 * questions.js
 * 機器人理財顧問專案的題庫。
 *
 * 每週作業會在 RoboAdvisor.questions 底下新增一個階段（phase1、phase2……）。
 * 各階段分開存放，之後幾週（行為情緒評估、財務條件、動態投資人風險畫像）
 * 就能直接新增，不需要動到第一階段的內容。
 *
 * 每題的 weight 是計入風險分數的權重（百分比，全部加總為 100）：
 * 決定「賠不賠得起」的硬性條件（損失承受能力、提款需求、投資期限）
 * 各 15%；財務緩衝（年齡、資產、收入）各 10%；主觀意向（投資目標、
 * 風險偏好）各 7.5%；知識與經驗只作輔助，各 5%。
 *
 * group: "capacity" 標記「客觀承受能力」題（年齡、收入、資產、投資期限、
 * 提款需求、損失承受能力），計分時會另外算一個能力分數當類型上限。
 * hardCap 是單題硬性上限：選到 triggerScore 以下的選項時，不管其他題
 * 答什麼，投資人類型最高只能到 maxType。
 *
 * 每個選項都有 1–5 分：1 分代表最保守／能力或意願最低，
 * 5 分代表最積極／能力或意願最高，各構面標準一致，方便加總與平均。
 */

window.RoboAdvisor = window.RoboAdvisor || {};

RoboAdvisor.questions = {
  phase1: [
    {
      id: "age",
      dimension: "年齡",
      weight: 10,
      group: "capacity",
      question: "您的年齡是？",
      options: [
        { text: "25 歲以下", score: 5 },
        { text: "25–34 歲", score: 5 },
        { text: "35–44 歲", score: 4 },
        { text: "45–54 歲", score: 3 },
        { text: "55–64 歲", score: 2 },
        { text: "65 歲以上", score: 1 },
      ],
    },
    {
      id: "income",
      dimension: "收入",
      weight: 10,
      group: "capacity",
      question: "您的收入相對於支出的穩定程度為何？",
      options: [
        { text: "非常穩定且遠高於支出", score: 5 },
        { text: "穩定且能舒適地涵蓋支出", score: 4 },
        { text: "足夠，但沒有太多餘裕", score: 3 },
        { text: "不太穩定或略顯緊張", score: 2 },
        { text: "不穩定或目前不足", score: 1 },
      ],
    },
    {
      id: "wealth",
      dimension: "資產",
      weight: 10,
      group: "capacity",
      question: "您目前大約有多少可投資資產（存款、基金、股票，不含自住房產）？",
      options: [
        { text: "新台幣 10 萬元以下", score: 1 },
        { text: "新台幣 10 萬－50 萬元", score: 2 },
        { text: "新台幣 50 萬－200 萬元", score: 3 },
        { text: "新台幣 200 萬－500 萬元", score: 4 },
        { text: "新台幣 500 萬元以上", score: 5 },
      ],
    },
    {
      id: "horizon",
      dimension: "投資期限",
      weight: 15,
      group: "capacity",
      hardCap: { triggerScore: 1, maxType: "moderate", reason: "您預計 1 年以內就會動用這筆資金，短期內沒有時間等待市場回升" },
      question: "您預計何時會需要動用這筆資金？",
      options: [
        { text: "1 年以內", score: 1 },
        { text: "1–3 年", score: 2 },
        { text: "3–5 年", score: 3 },
        { text: "5–10 年", score: 4 },
        { text: "10 年以上", score: 5 },
      ],
    },
    {
      id: "goal",
      dimension: "投資目標",
      weight: 7.5,
      question: "以下何者最能描述您的主要投資目標？",
      options: [
        { text: "保本／緊急預備金", score: 1 },
        { text: "產生穩定收入", score: 2 },
        { text: "兼顧成長與收入", score: 3 },
        { text: "追求長期成長", score: 4 },
        { text: "追求最大成長，能接受波動", score: 5 },
      ],
    },
    {
      id: "lossCapacity",
      dimension: "損失承受能力",
      weight: 15,
      group: "capacity",
      hardCap: { triggerScore: 1, maxType: "moderate", reason: "投資組合下跌 20% 會嚴重影響您的日常生活需求" },
      question: "如果您的投資組合一年內下跌 20%，會如何影響您的生活？",
      options: [
        { text: "會嚴重影響我的日常生活需求", score: 1 },
        { text: "會有困難，但我能應付", score: 2 },
        { text: "只是造成不便，僅此而已", score: 3 },
        { text: "對我的生活影響很小", score: 4 },
        { text: "幾乎沒有影響，我還有其他資源", score: 5 },
      ],
    },
    {
      id: "riskTolerance",
      dimension: "風險偏好",
      weight: 7.5,
      question: "如果您的投資組合在一個月內突然下跌 20%，您最可能怎麼做？",
      options: [
        { text: "立刻全部賣出以停止損失", score: 1 },
        { text: "賣出部分持股以降低風險", score: 2 },
        { text: "繼續持有並等待市場回升", score: 3 },
        { text: "視為加碼機會，小額買進", score: 4 },
        { text: "趁低價大幅加碼買進", score: 5 },
      ],
    },
    {
      id: "liquidityNeed",
      dimension: "提款需求",
      weight: 15,
      group: "capacity",
      hardCap: { triggerScore: 1, maxType: "moderate", reason: "您沒有其他資金來源可應付計劃外的現金需求，且需要從此帳戶提款" },
      question: "以下哪個句子最能說明您在面對計劃外的大量現金需求時，需要從該投資帳戶提款的情況？",
      note: "備註：(1) 投資帳戶提款包括在一般市場情況下可中途解約或贖回金融商品的情形。(2) 提前贖回可能導致原始投入本金之損失。",
      options: [
        { text: "我沒有其他資金來源以滿足計劃外的現金需求，且需要從此帳戶進行提款", score: 1 },
        { text: "我還有其他資金來源以滿足計劃外的現金需求，且需要從此帳戶進行大部分提款", score: 2 },
        { text: "我還有其他資金來源以滿足計劃外的現金需求，且需要從此帳戶進行部分提款", score: 3 },
        { text: "我還有其他資金來源以滿足計劃外的現金需求，且不太可能需要從此帳戶進行提款", score: 4 },
        { text: "我還有其他資金來源以滿足計劃外的現金需求，且不需要從此帳戶進行提款", score: 5 },
      ],
    },
    {
      id: "productKnowledge",
      dimension: "金融商品知識",
      weight: 5,
      question: "您對金融商品的知識與理解是？",
      note: "定義：一般的金融商品如股票、ETFs、債券、投資型保險和基金等；進階的金融商品如結構型商品、權證、選擇權、期貨、遠期合約等。備註：您所勾選的選項中的金融商品可能與實際投資的金融商品不同。",
      options: [
        { text: "對金融商品完全不了解，但想進一步理解", score: 1 },
        { text: "對一般的金融商品（不包括進階的金融商品）的基本知識和理解有限", score: 2 },
        { text: "對一般的金融商品（不包括進階的金融商品）有基本的知識和理解", score: 3 },
        { text: "對一般的金融商品和進階的金融商品有一些知識和理解", score: 4 },
        { text: "對一般的金融商品和進階的金融商品有豐富的知識和理解", score: 5 },
      ],
    },
    {
      id: "investmentExperience",
      dimension: "投資經驗",
      weight: 5,
      question: "請描述您的金融商品投資經驗：",
      note: "定義：一般的金融商品如股票、ETFs、債券、投資型保險和基金等；進階的金融商品如結構型商品、權證、選擇權、期貨、遠期合約等。備註：您所勾選的選項中的金融商品可能與實際投資的金融商品不同。",
      options: [
        { text: "除了存款（含活期存款及定期存款）、貨幣型基金以外，我在金融商品投資方面只有有限的經驗", score: 1 },
        { text: "我在金融商品投資方面擁有一些經驗，且只限於一般的金融商品", score: 2 },
        { text: "我在金融商品投資方面擁有相當的經驗，但只限於一般的金融商品", score: 3 },
        { text: "我在金融商品投資方面擁有相當的經驗，包括一般的金融商品和進階的金融商品", score: 4 },
        { text: "我在金融商品投資方面擁有豐富的經驗，包括一般的金融商品和進階的金融商品", score: 5 },
      ],
    },
  ],
};
