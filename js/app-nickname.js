/**
 * app-nickname.js
 * 
 * 【功能說明】
 * 問卷開始前的暱稱步驟：投資人先輸入想使用的暱稱，才會進入第一階段問卷。
 * - 暱稱存在記憶體中（並備份到瀏覽器的 localStorage，方便使用者點選「重新測驗」時自動預填）。
 * - 當最後一頁結果送出到後端時，由 app-phase2.js 透過 RoboAdvisor.nickname.get() 取用。
 */

// 使用 IIFE（Immediately Invoked Function Expression，立即執行函式）
// 好處：將變數與函式封裝在獨立作用域中，避免變數污染全域（window），防止與其他腳本的變數名稱衝突。
(function () {

  // 1. 常數設定 (Constants)
  const NICKNAME_MAX = 20; // 暱稱的最大字數限制（不可超過 20 個字元）
  const NICKNAME_KEY = "roboAdvisorNickname"; // 儲存在瀏覽器 localStorage 中的鍵名 (Key)

  // 2. DOM 元素選取 (取得 HTML 畫面上的元素節點)
  const stepEl = document.getElementById("nicknameStep");   // 暱稱輸入區塊的外層容器
  const wizardEl = document.getElementById("wizard");       // 問卷題目主體區塊
  const formEl = document.getElementById("nicknameForm");   // 暱稱輸入表單 (<form>)
  const inputEl = document.getElementById("nicknameInput"); // 暱稱文字輸入框 (<input>)
  const btnEl = document.getElementById("nicknameBtn");     // 「開始測驗」確認按鈕 (<button>)
  const errorEl = document.getElementById("nicknameError"); // 錯誤訊息提示文字容器

  // 3. 狀態變數 (State)
  let nickname = ""; // 儲存使用者確認送出的暱稱（保存在記憶體中）

  // 4. 輔助函式與核心邏輯
  /**
   * 取得已清理的使用者輸入內容
   * 使用 .trim() 移除字串前後的多餘空白，避免使用者只輸入空白鍵
   * @returns {string} 去除前後空白後的字串
   */
  function cleaned() {
    return inputEl.value.trim();
  }

  /**
   * 驗證暱稱格式是否合法，並即時更新介面狀態（錯誤訊息、按鈕能否點擊）
   * @returns {boolean} 驗證是否通過（true: 通過 / false: 不通過）
   */
  function validate() {
    const value = cleaned();
    let message = "";

    // 檢查字數是否超出上限
    // 小知識：使用 [...value].length（擴展運算子）而不是 value.length，
    // 是為了正確計算 Emoji（例如 😊）或特殊 Unicode 字元，避免一個表情符號被誤算為 2 個字元。
    if ([...value].length > NICKNAME_MAX) {
      message = `暱稱最多 ${NICKNAME_MAX} 個字`;
    }

    // 更新錯誤訊息文字
    errorEl.textContent = message;

    // 控制錯誤訊息顯示/隱藏：
    // classList.toggle("hidden", 條件) -> 若條件為 true 則加上 "hidden" class（隱藏），反之移除
    // 當 message 為空字串時（!message 為 true），隱藏錯誤訊息
    errorEl.classList.toggle("hidden", !message);

    // 控制按鈕啟用狀態：
    // 條件：如果「沒有輸入任何字」或「有錯誤訊息」，按鈕設為禁用 (disabled)
    btnEl.disabled = value.length === 0 || message !== "";

    // 回傳布林值表示是否驗證通過（按鈕沒被禁用即代表通過）
    return !btnEl.disabled;
  }

  /**
   * 表單送出事件處理函式（點擊按鈕或在輸入框按下 Enter 鍵）
   * @param {Event} event 表單送出事件物件
   */
  function submit(event) {
    // 阻止表單預設的送出重整行為（防止整個網頁重新整理刷新）
    event.preventDefault();

    // 再次確認驗證，若未通過則直接中斷不繼續
    if (!validate()) return;

    // 將已清理的文字存入記憶體變數
    nickname = cleaned();

    // 嘗試將暱稱儲存到瀏覽器的本機儲存空間 (localStorage)
    // 因為在部分瀏覽器的無痕模式、或使用者停用 Cookie/Storage 時，呼叫 setItem 可能會拋出安全性例外錯誤。
    // 用 try...catch 包覆可確保即使無法儲存，也不會讓整個網頁程式崩潰中斷。
    try {
      localStorage.setItem(NICKNAME_KEY, nickname);
    } catch (e) {
      // 無法寫入 localStorage 時仍可繼續作答
    }

    // 切換畫面：隱藏暱稱步驟，顯示第一階段問卷
    stepEl.classList.add("hidden");
    wizardEl.classList.remove("hidden");

    // 平滑滾動至問卷最上方，提供舒適流暢的視覺體驗
    wizardEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * 提供給外部呼叫：重新測驗時回到暱稱步驟（保留上次輸入的暱稱供使用者修改）
   */
  function show() {
    stepEl.classList.remove("hidden"); // 顯示暱稱輸入區塊
    validate();                        // 重新計算當前輸入狀態以更新按鈕
    inputEl.focus();                   // 自動聚焦到輸入框，方便使用者直接打字
    stepEl.scrollIntoView({ behavior: "smooth", block: "start" }); // 畫面捲動到暱稱區塊
  }

  // 5. 初始化流程 (Initialization)
  // 頁面載入時，嘗試從 localStorage 取出上次儲存的暱稱自動預填入輸入框
  try {
    inputEl.value = localStorage.getItem(NICKNAME_KEY) || "";
  } catch (e) {
    inputEl.value = "";
  }

  // 初始執行一次驗證（若有預填暱稱則自動啟用按鈕，否則按鈕維持禁用）
  validate();

  // 6. 事件監聽 (Event Listeners)
  // 當使用者在輸入框打字時（input 事件），即時進行驗證並更新按鈕狀態
  inputEl.addEventListener("input", validate);

  // 當表單觸發送出動作時（點擊開始測驗按鈕或按 Enter），執行 submit 函式
  formEl.addEventListener("submit", submit);

  // 7. 匯出介面給全域使用 (Public API)
  // 將需要對外開放的方法掛載到全域的 RoboAdvisor 物件上，
  // 讓其他檔案（如 app-phase2.js 或重新測驗的按鈕）能夠存取與呼叫
  RoboAdvisor.nickname = {
    get: () => nickname, // 取得使用者輸入的暱稱
    show,                // 重新顯示暱稱輸入畫面
  };
})();
