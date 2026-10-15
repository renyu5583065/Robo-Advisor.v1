/**
 * app-nickname.js
 * 問卷開始前的暱稱步驟：投資人先輸入想使用的暱稱，才會進入第一階段。
 * 暱稱存在記憶體（並備份到 localStorage 方便「重新測驗」時預填），
 * 結果頁送出到後端時由 app-phase2.js 透過 RoboAdvisor.nickname.get() 取用。
 */

(function () {
  const NICKNAME_MAX = 20;
  const NICKNAME_KEY = "roboAdvisorNickname";

  const stepEl = document.getElementById("nicknameStep");
  const wizardEl = document.getElementById("wizard");
  const formEl = document.getElementById("nicknameForm");
  const inputEl = document.getElementById("nicknameInput");
  const btnEl = document.getElementById("nicknameBtn");
  const errorEl = document.getElementById("nicknameError");

  let nickname = "";

  function cleaned() {
    return inputEl.value.trim();
  }

  function validate() {
    const value = cleaned();
    let message = "";
    if ([...value].length > NICKNAME_MAX) message = `暱稱最多 ${NICKNAME_MAX} 個字`;
    errorEl.textContent = message;
    errorEl.classList.toggle("hidden", !message);
    btnEl.disabled = value.length === 0 || message !== "";
    return !btnEl.disabled;
  }

  function submit(event) {
    event.preventDefault();
    if (!validate()) return;
    nickname = cleaned();
    try {
      localStorage.setItem(NICKNAME_KEY, nickname);
    } catch (e) {
      // 無法寫入 localStorage 時仍可繼續作答
    }
    stepEl.classList.add("hidden");
    wizardEl.classList.remove("hidden");
    wizardEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** 重新測驗：回到暱稱步驟（保留上次輸入的暱稱供修改）。 */
  function show() {
    stepEl.classList.remove("hidden");
    validate();
    inputEl.focus();
    stepEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  try {
    inputEl.value = localStorage.getItem(NICKNAME_KEY) || "";
  } catch (e) {
    inputEl.value = "";
  }
  validate();

  inputEl.addEventListener("input", validate);
  formEl.addEventListener("submit", submit);

  RoboAdvisor.nickname = {
    get: () => nickname,
    show,
  };
})();
