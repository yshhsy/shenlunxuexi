// 申论学习 · V1（基于考公学习 app 改造的申论专项版）
// 材料 + 题目 → 自己动笔 → 对照参考答案自评「答到了 / 没答到」→ 计入学习记录
// 卷别总览（国考副省/地市/执法 + 天津） · 重学本 · 收藏本 · 每日一学 · 方法课 · localStorage 持久化

(function () {
  "use strict";

  // ---------- 题库汇总 ----------
  // 动态收集：按 index.html 引入顺序扫描 window 上所有 QUESTIONS_* 题库
  var BANKS = [];
  Object.keys(window).forEach(function (k) {
    if (/^QUESTIONS_[A-Z0-9_]+$/.test(k) && window[k] && window[k].questions) BANKS.push(window[k]);
  });

  var ALL_MATERIALS = {};
  var ALL_QUESTIONS = [];
  BANKS.forEach(function (bank) {
    if (!bank) return;
    Object.keys(bank.materials || {}).forEach(function (k) {
      // 兼容两种材料格式：旧库存纯字符串，新年份库存 {module, source, content} 对象
      var m = bank.materials[k];
      ALL_MATERIALS[k] = (m && typeof m === "object") ? (m.content || "") : m;
    });
    (bank.questions || []).forEach(function (q) {
      if (bank.exam && !q.exam) q.exam = bank.exam; // 题库级 exam 标记下发到每题
      ALL_QUESTIONS.push(q);
    });
  });

  // 卷别：国考副省 / 国考地市 / 国考行政执法 / 天津市考（按题源自动归卷）
  var VOLUMES = [
    { key: "gkfs", zi: "省", name: "国考副省级", short: "副省", desc: "2021-2025 · 归纳概括 / 应用文 / 大作文" },
    { key: "gkds", zi: "市", name: "国考地市级", short: "地市", desc: "2021-2025 · 归纳概括 / 应用文 / 大作文" },
    { key: "gkzf", zi: "法", name: "国考行政执法", short: "执法", desc: "2022-2025 · 综合分析 / 应用文 / 大作文" },
    { key: "tj", zi: "津", name: "天津市考", short: "天津", desc: "2021-2025 · 区县 / 市级卷精选" }
  ];
  var VOLUME_SHORT = { gkfs: "副省", gkds: "地市", gkzf: "执法", tj: "天津", other: "其他" };
  function volumeOf(q) {
    var s = q.source || "";
    if (s.indexOf("国考副省") >= 0) return "gkfs";
    if (s.indexOf("国考地市") >= 0) return "gkds";
    if (s.indexOf("行政执法") >= 0) return "gkzf";
    if (s.indexOf("天津") >= 0) return "tj";
    return "other";
  }

  // 考试范围：国考 / 天津市考（首页切换，全站按范围过滤）
  function examOf(q) { return q.exam || "guokao"; }
  function scopeExam() { return store.examScope || "guokao"; }
  function scopedPool() {
    var ex = scopeExam();
    return ALL_QUESTIONS.filter(function (q) { return examOf(q) === ex; });
  }

  // 知识点：新题挂在题上（knowledgeIds），老题查映射表（QUESTION_KNOWLEDGE）
  function kpsOf(q) {
    var ids = (q.knowledgeIds && q.knowledgeIds.length)
      ? q.knowledgeIds
      : (window.QUESTION_KNOWLEDGE && window.QUESTION_KNOWLEDGE[q.id]) || [];
    var K = window.KNOWLEDGE || {};
    return ids
      .filter(function (k) { return K[k]; })
      .map(function (k) { return K[k]; });
  }

  // ---------- localStorage ----------
  var STORE_KEY = "shenlun-app-v1";

  function defaultStore() {
    return {
      today: "",          // 今日日期串
      todayCount: 0,      // 今日已练题数
      days: {},           // "2025-09-24" -> 当日题数（印谱数据源）
      stats: {},          // qid -> {right, wrong}
      wrong: {},          // qid -> {fails, lastWrongAt, lastPracticedAt, rightStreak}
      favorites: {},       // qid -> 1（手动收藏）
      notes: {},          // qid -> 用户备注文本
      answeredOrder: [],  // 最近学过的题 id（避免重复出题）
      examScope: "guokao", // 学习范围："guokao" | "tianjin"
      mixCount: 3,          // 随机学习题量：3 | 5 | 10
      dailyDate: "",       // 每日一学当前组卷日期（跨天重置）
      dailyDone: {},       // 每日一学已学 qid -> 1（今天当轮完成进度）
      haptic: true,        // 自评震动反馈（iOS 仅加到主屏幕有效，安卓浏览器多数有效）
      darkMode: "auto",    // 深色模式："auto" 跟随系统 | "on" | "off"
      fontScale: "md",      // 题干字号："md" 标准 | "lg" 大 | "xl" 特大
      theme: "blue",        // 界面色调："blue" 蓝 | "green" 绿 | "purple" 紫 | "orange" 橙 | "pink" 粉
      sound: false,        // 自评音效：答到清脆/没答到低沉（AudioContext 短音）
      autoNext: false      // 答到自动下一题（没答到不自动，留时间看解析）
    };
  }

  function fmtDate(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(defaultStore(), JSON.parse(raw));
      return defaultStore();
    } catch (e) { /* 损坏则重建 */ }
    return defaultStore();
  }

  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 忽略 */ }
  }

  var store = loadStore();

  // 打卡火焰：连续 ≥3 天点亮（内联 SVG，随文字色不随主题变）
  var FLAME_SVG = '<svg class="flame-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="#ff9f43" d="M12 2c.6 3.2-.9 4.9-2.4 6.5C8 10.2 6.5 11.9 6.5 15a5.5 5.5 0 0 0 11 0c0-1.6-.6-2.9-1.4-4-.3 1-.9 1.8-1.8 2.3.4-3.6-.8-8-2.3-11.3z"/><path fill="#ffd08a" d="M12 21.2a3.6 3.6 0 0 1-3.6-3.6c0-1.8 1.1-2.8 2.1-3.8.8-.8 1.5-1.5 1.7-2.6 1.3 1.4 3.4 3.6 3.4 6.4a3.6 3.6 0 0 1-3.6 3.6z"/></svg>';

  // ---------- 震动反馈（V3.24.0 体验打磨）----------
  function buzz(pattern) {
    if (!store.haptic) return;
    try {
      if (navigator.vibrate) { navigator.vibrate(pattern); return; }
      // iOS Safari 无 navigator.vibrate：用 AudioContext 毫秒级静音脉冲做触感代理（无声、不干扰）
      if (window.__buzzAc === undefined) {
        var AC = window.AudioContext || window.webkitAudioContext;
        window.__buzzAc = AC ? new AC() : null;
      }
      if (!window.__buzzAc) return;
      var ac = window.__buzzAc;
      if (ac.state === "suspended" && ac.resume) ac.resume();
      var t = ac.currentTime;
      pattern.forEach(function (ms) {
        var osc = ac.createOscillator();
        var gain = ac.createGain();
        gain.gain.value = 0.00001; // 近乎无声明，仅供 iOS 震动马达联动判断
        osc.connect(gain); gain.connect(ac.destination);
        osc.start(t); osc.stop(t + ms / 1000);
        t += ms / 1000 + 0.04;
      });
    } catch (e) { /* 静默降级：无触感不影响使用 */ }
  }
  function buzzJudge(correct, streakNow) {
    if (correct) buzz(streakNow >= 3 ? [30, 50, 30, 50, 80] : (streakNow >= 2 ? [24, 60, 24] : 18));
    else buzz([60, 40, 60]);
  }

  // ---------- 判卷音效（V3.30.0）：答对上行双音/答错低沉短音，AudioContext 本地合成零素材 ----------
  function ding(correct) {
    if (!store.sound) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (window.__dingAc === undefined) window.__dingAc = new AC();
      var ac = window.__dingAc;
      if (ac.state === "suspended" && ac.resume) ac.resume();
      var t = ac.currentTime;
      var notes = correct ? [[660, 0], [880, 0.09]] : [[196, 0]];
      notes.forEach(function (n) {
        var osc = ac.createOscillator();
        var gain = ac.createGain();
        osc.type = "sine";
        osc.frequency.value = n[0];
        gain.gain.setValueAtTime(0.12, t + n[1]);
        gain.gain.exponentialRampToValueAtTime(0.001, t + n[1] + (correct ? 0.18 : 0.3));
        osc.connect(gain); gain.connect(ac.destination);
        osc.start(t + n[1]); osc.stop(t + n[1] + (correct ? 0.2 : 0.32));
      });
    } catch (e) { /* 静默降级 */ }
  }
  var todayStr = fmtDate(new Date());

  if (store.today !== todayStr) {
    store.today = todayStr;
    store.todayCount = 0;
    saveStore();
  }

  // 每日一练：跨天重置当日进度
  if (store.dailyDate !== todayStr) {
    store.dailyDate = todayStr;
    store.dailyDone = {};
    saveStore();
  }

  function syncToday() {
    store.days[todayStr] = store.todayCount;
  }

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };

  var views = {
    home: $("view-home"),
    quiz: $("view-quiz"),
    wrong: $("view-wrong"),
    fav: $("view-fav"),
    catalog: $("view-catalog"),
    slguide: $("view-sl-guide"),
    methods: $("view-methods"),
    stats: $("view-stats"),
    settings: $("view-settings"),
    search: $("view-search")
  };

  // ---------- 工具 ----------
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  var CN_NUMS = ["一", "二", "三", "四", "五", "六", "七", "八"];

  function fmtRel(ts) {
    if (!ts || !isFinite(ts)) return "早前";
    var day = 24 * 3600 * 1000;
    var diff = Math.floor((Date.now() - ts) / day);
    if (diff <= 0) return "今天";
    if (diff === 1) return "昨天";
    return diff + " 天前";
  }

  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2400);
  }

  // ---------- 列表页滚动位置记忆（返回时回到上次浏览处，如卷目滑到 80 题返回仍在 80 题） ----------
  var LIST_VIEWS = ["home", "catalog", "wrong", "fav", "search"];
  var scrollMemo = {};

  function showView(name, keepScroll) {
    var cur = null;
    Object.keys(views).forEach(function (k) { if (views[k].hidden === false) cur = k; });
    var moveFocus = cur && views[cur].contains && views[cur].contains(document.activeElement);
    if (cur && LIST_VIEWS.indexOf(cur) >= 0 && typeof window !== "undefined" && window.scrollY) {
      scrollMemo[cur] = window.scrollY; // 离开列表页前记住浏览位置
    }
    Object.keys(views).forEach(function (k) { views[k].hidden = (k !== name); });
    $("btn-back").hidden = (name === "home");
    $("btn-home").hidden = (name === "home");
    renderTabbar(name);
    var y = (keepScroll && scrollMemo[name]) || 0;
    if (y > 0 && document.documentElement) {
      // smooth 滚动会让恢复变成从顶部滑下来的动画，恢复位置需瞬时完成
      var prev = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, y);
      document.documentElement.style.scrollBehavior = prev;
    } else {
      window.scrollTo(0, 0);
    }
    if (moveFocus) {
      var target = views[name].querySelector(".view-title") ||
        (name === "quiz" ? $("quiz-head") : views[name]);
      if (target && target.focus) {
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
    }
  }

  // ---------- 底部导航 ----------
  var TAB_MAP = { home: "tab-home", wrong: "tab-wrong", fav: "tab-fav", stats: "tab-stats", settings: "tab-settings" };

  function renderTabbar(activeView) {
    var activeTab = TAB_MAP[activeView] || null;
    ["tab-home", "tab-stats", "tab-wrong", "tab-fav", "tab-settings"].forEach(function (id) {
      $(id).classList.toggle("on", id === activeTab);
      $(id).setAttribute("aria-current", id === activeTab ? "page" : "false");
    });
    // 导航角标同步（错题/收藏数，当前范围）
    var ex = scopeExam();
    var nW = Object.keys(store.wrong).filter(function (id2) {
      var q = ALL_QUESTIONS.find(function (x) { return x.id === id2; });
      return q && examOf(q) === ex;
    }).length;
    var wBadge = $("tab-wrong-b");
    wBadge.textContent = nW;
    wBadge.hidden = nW === 0;
    var nF = Object.keys(store.favorites || {}).filter(function (id2) {
      var q = ALL_QUESTIONS.find(function (x) { return x.id === id2; });
      return q && examOf(q) === ex;
    }).length;
    var fBadge = $("tab-fav-b");
    fBadge.textContent = nF;
    fBadge.hidden = nF === 0;
  }

  // 返回上一级：答题页回进入前的页面；申论指南回卷目；方法课/搜题回首页；其余视图回首页
  function goBack() {
    if (!views.quiz.hidden) { if (confirmQuitIfNeeded()) backToOrigin(); return; }
    if (!views.slguide.hidden) { showView("catalog", true); return; }
    if (!views.methods.hidden) { showView("home", true); return; }
    if (!views.search.hidden) { showView("home", true); return; }
    goHome(true);
  }

  // ---------- 出题策略 ----------
  // 隔期优先：超过 2 天没练的错题优先重出；未做错的新题次之；避开最近答过的
  function pickQuestions(pool, count) {
    var now = Date.now();
    var TWO_DAYS = 2 * 24 * 3600 * 1000;
    var recent = store.answeredOrder.slice(-Math.min(5, pool.length));

    var due = [];
    var fresh = [];
    pool.forEach(function (q) {
      if (recent.indexOf(q.id) >= 0) return;
      var w = store.wrong[q.id];
      if (w && (!w.lastPracticedAt || now - w.lastPracticedAt > TWO_DAYS)) {
        due.push(q);
      } else if (!w) {
        fresh.push(q);
      }
    });

    var picked = shuffle(due).slice(0, count);
    if (picked.length < count) {
      picked = picked.concat(shuffle(fresh).slice(0, count - picked.length));
    }
    if (picked.length < count) {
      var rest = pool.filter(function (q) { return picked.indexOf(q) < 0; });
      picked = picked.concat(shuffle(rest).slice(0, count - picked.length));
    }
    return shuffle(picked).slice(0, count);
  }

  // ---------- 每日一练：按日期+范围种子固定组卷，同一天题目一致，可断点续练 ----------
  function seededShuffle(arr, seed) {
    var a = arr.slice();
    var s = 0;
    for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    for (var j = a.length - 1; j > 0; j--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      var k = s % (j + 1);
      var t = a[j]; a[j] = a[k]; a[k] = t;
    }
    return a;
  }

  function dailyGroup() {
    var pool = scopedPool();
    if (!pool.length) return [];
    return seededShuffle(pool, todayStr + "|" + scopeExam()).slice(0, Math.min(3, pool.length));
  }

  // 首页每日一练卡：进度/完成态/重练入口
  function renderDailyCard() {
    var card = $("daily-card");
    if (!card) return;
    var group = dailyGroup();
    card.hidden = group.length === 0;
    if (!group.length) return;
    var inGroup = {};
    group.forEach(function (q) { inGroup[q.id] = 1; });
    var done = 0;
    Object.keys(store.dailyDone).forEach(function (id) { if (inGroup[id]) done += 1; });
    var pct = Math.round(done * 100 / group.length);
    var finished = done >= group.length;
    $("daily-done-tag").hidden = !finished;
    $("daily-title").textContent = finished ? "今日一学已完成" : "每日一学";
    $("daily-meta").textContent = finished
      ? "已学 " + done + " / " + group.length + " 题 · 点击回看解析"
      : (done > 0
        ? "今日已完成 " + done + " / " + group.length + " 题，继续冲"
        : "今日 " + group.length + " 题待打卡");
    $("daily-bar-i").style.width = pct + "%";
  }

  // ---------- 答题状态 ----------
  var session = {
    queue: [],
    current: null,
    index: 0,
    mode: null,          // "module" | "mixed" | "wrong" | "fav"
    moduleId: null,
    from: "home",        // 进入来源："home" | "catalog" | "wrong" | "fav"（返回时回哪）
    selected: null,
    confirmed: false,
    peeked: false,       // 行测「直接看答案」中：true 后可回本题继续做或直接下一题
    timerStart: 0,
    timerId: null,
    rightCount: 0,
    times: []            // 每题用时（秒），实际答题数 = times.length，报告按此统计
  };

  // 答题页的“考试元素”显隐（结课小结时隐藏）
  var QUIZ_CHROME_IDS = ["quiz-head", "quiz-actions", "result-area", "kbd-tip"];
  function setQuizChrome(visible) {
    QUIZ_CHROME_IDS.forEach(function (id) { $(id).hidden = !visible; });
    document.querySelector(".qian-question").hidden = !visible;
    // 材料笺有自己的显隐逻辑：结课时隐藏，开考时交给 renderQuestion 按题设置
    if (!visible) $("material-card").hidden = true;
    $("summary-wrap").hidden = visible;
  }

  function startQuiz(mode, moduleId, opts) {
    opts = opts || {};
    var pool;
    if (mode === "wrong") {
      pool = scopedPool().filter(function (q) { return store.wrong[q.id]; });
      if (pool.length === 0) { toast("重学本还是空的，自评「没答到」的题会自动收录"); return; }
    } else if (mode === "fav") {
      pool = scopedPool().filter(function (q) { return store.favorites[q.id]; });
      if (pool.length === 0) { toast("收藏本还是空的，学习时点 ☆ 收藏想重练的题"); return; }
    } else if (mode === "daily") {
      pool = dailyGroup();
      if (pool.length === 0) { toast("当前范围暂无可学题目"); return; }
    } else if (mode === "recite") {
      pool = scopedPool().filter(function (q) { return volumeOf(q) === moduleId; });
    } else if (mode === "module") {
      pool = scopedPool().filter(function (q) { return volumeOf(q) === moduleId; });
    } else {
      pool = scopedPool(); // 随机学习：全卷抽题
    }

    session.mode = mode;
    session.moduleId = moduleId || null;
    session.from = opts.from || "home";
    session.pickCount = opts.pick || 0; // 记住抽题题量：总结页「再来一轮」按同题量重抽
    // 抽题练习：从模块题池随机抽 N 题（复用智能抽题：错题优先+近期练过的不出）
    session.queue = opts.pick
      ? pickQuestions(pool, opts.pick)
      : (mode === "mixed" ? pickQuestions(pool, store.mixCount || 10) : pool.slice()); // 列表模式保持列表顺序，可滑动浏览
    session.index = opts.startIndex || 0;
    if (session.index >= session.queue.length) session.index = 0;
    // 每日一练断点续练：跳到第一道今天还没答的题（全部答完则从第一题再来一轮）
    if (mode === "daily" && !opts.startIndex) {
      for (var di = 0; di < session.queue.length; di++) {
        if (!store.dailyDone[session.queue[di].id]) { session.index = di; break; }
      }
    }
    session.rightCount = 0;
    session.times = [];
    session.answeredThisRound = {};
    session.streak = 0;

    if (session.queue.length === 0) { toast("该卷暂时没有题目"); return; }
    showView("quiz");
    setQuizChrome(true);
    renderQuestion();
  }

  // 单题会话：搜题结果点击 / 好友分享深链（?q=<id>）进入，答完回来源页不出报告
  function startSingle(q, from) {
    session.mode = "single";
    session.moduleId = null;
    session.from = from || "home";
    session.queue = [q];
    session.index = 0;
    session.rightCount = 0;
    session.times = [];
    session.answeredThisRound = {};
    session.streak = 0;
    showView("quiz");
    setQuizChrome(true);
    renderQuestion();
  }

  // 本轮实时统计：随自评更新，随时看到本轮答到率
  function renderRoundStat() {
    var el = $("round-stat");
    if (!el) return;
    var done = session.times.length;
    if (!done) { el.hidden = true; return; }
    el.hidden = false;
    var right = session.rightCount;
    var acc = Math.round(right * 100 / done);
    el.textContent = "本轮已学 " + done + " · 答到 " + right + " · 待重学 " + (done - right) + " · 答到率 " + acc + "%";
  }

  function renderQuestion() {
    var q = session.queue[session.index];
    session.current = q;
    session.selected = null;
    session.confirmed = false;
    session.peeked = false;

    var modName = session.mode === "mixed"
      ? "随机学习"
      : session.mode === "daily" ? "每日一学"
      : session.mode === "recite" ? "温习 · " + (VOLUME_SHORT[q.sessionModId || session.moduleId] || "")
      : (session.mode === "wrong" ? "重学练习" : session.mode === "fav" ? "收藏学习"
      : session.mode === "single" ? "单题学习"
      : (VOLUME_SHORT[session.moduleId] || "申论") + "专项");
    $("quiz-module-tag").textContent = modName;
    $("quiz-source-tag").textContent = q.source;
    $("quiz-progress").textContent = (session.index + 1) + " / " + session.queue.length;
    renderRoundStat();
    $("quiz-timer").textContent = "00:00";
    $("quiz-timer").hidden = session.mode === "recite"; // 温习模式不计时

    // 待重学标记：累计自评没答到 ≥ 2 次
    var risky = store.stats[q.id] && store.stats[q.id].wrong >= 2;
    var riskEl = $("quiz-risk");
    riskEl.hidden = !risky;
    riskEl.textContent = "待重学";

    // 上一题/下一题小箭头边界禁用
    $("btn-prev-q").disabled = session.index === 0;
    $("btn-next-q").disabled = session.index + 1 >= session.queue.length;

    // 收藏星标
    var fav = !!store.favorites[q.id];
    var favBtn = $("btn-fav");
    favBtn.textContent = fav ? "★" : "☆";
    favBtn.classList.toggle("on", fav);
    favBtn.setAttribute("aria-pressed", fav ? "true" : "false");
    favBtn.setAttribute("aria-label", fav ? "取消收藏本题" : "收藏本题");

    // 个人备注
    $("note-input").value = store.notes[q.id] || "";

    // 材料
    var matCard = $("material-card");
    if (q.materialId) {
      matCard.hidden = false;
      setRichText($("material-body"), ALL_MATERIALS[q.materialId] || "");
      $("material-body").classList.remove("collapsed");
      $("btn-toggle-material").textContent = "收起";
      $("btn-toggle-material").setAttribute("aria-expanded", "true");
    } else {
      matCard.hidden = true;
    }

    // 题干（申论无选项，学习流：材料+题目 → 自己动笔 → 对照参考答案自评）
    setRichText($("question-text"), blankify(q.question));
    var figBox = $("q-figure");
    figBox.innerHTML = "";
    figBox.hidden = true;
    var optsBox = $("options");
    optsBox.innerHTML = "";
    optsBox.hidden = true;
    var peekBtn = $("btn-peek");
    peekBtn.hidden = session.mode === "recite"; // 温习模式参考答案直接展示
    peekBtn.textContent = "写完了，对照参考答案";
    var confirmBtn = $("btn-confirm");
    confirmBtn.hidden = true;
    confirmBtn.textContent = "答到了 ✓";
    confirmBtn.disabled = false;
    $("btn-miss").hidden = true;

    // 按钮与结果区
    $("btn-next").hidden = true;
    $("result-area").hidden = true;
    if (session.mode === "recite") reciteShow(q); // 温习模式：参考答案直出，不计入成绩

    // 计时（自己动笔写作的时间，对照参考答案时停止）
    session.timerStart = Date.now();
    clearInterval(session.timerId);
    if (session.mode === "recite") return;
    session.timerId = setInterval(function () {
      var sec = Math.floor((Date.now() - session.timerStart) / 1000);
      var m = String(Math.floor(sec / 60)).padStart(2, "0");
      var s = String(sec % 60).padStart(2, "0");
      $("quiz-timer").textContent = m + ":" + s;
    }, 1000);
  }

  // 当前题备注落盘（切题前/失焦时调用）
  function saveCurrentNote() {
    var id = session.current && session.current.id;
    if (!id) return;
    var v = ($("note-input").value || "").trim();
    if (v) store.notes[id] = v;
    else if (store.notes[id]) delete store.notes[id];
    saveStore();
  }

  // ---------- 平滑翻页（带方向滑出/滑入，滑动、箭头、键盘、下一题共用） ----------
  var QCARD = document.querySelector(".qian-question");
  var ANIM = typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var pageTimer = null;

  function pageTo(delta) {
    clearTimeout(session.autoNextT);
    var next = session.index + delta;
    if (next < 0 || next >= session.queue.length) return;
    // 上一次翻页还未换内容时先落到当前序号，避免把备注写进另一题。
    if (pageTimer) {
      saveCurrentNote();
      clearTimeout(pageTimer);
      pageTimer = null;
      renderQuestion();
    }
    saveCurrentNote();
    session.index = next;
    if (!ANIM || !QCARD) { renderQuestion(); return; }
    // 重复滑动时打断上一次动画，从当前状态重新起翻
    QCARD.classList.remove("page-out-left", "page-out-right", "page-in-left", "page-in-right");
    // 第一段：旧卡滑出（期间内容不变，可继续作答当前题）
    QCARD.classList.add(delta > 0 ? "page-out-left" : "page-out-right");
    pageTimer = setTimeout(function () {
      // 第二段：换内容，新卡从另一侧滑入
      QCARD.classList.remove("page-out-left", "page-out-right");
      renderQuestion();
      QCARD.classList.add(delta > 0 ? "page-in-right" : "page-in-left");
      pageTimer = setTimeout(function () {
        QCARD.classList.remove("page-in-left", "page-in-right");
        pageTimer = null;
      }, 300);
    }, 170);
  }

  // 上一题（浏览模式：无论是否作答都可回看）
  function prevQuestion() { pageTo(-1); }

  // 浏览式下一题（只切题不结课；判卷后的“下一题”按钮另有结课分支）
  function browseNext() { pageTo(1); }

  function selectOption(i) {
    // 申论无选项：键盘 1/2 映射为自评
    if (i === 0) shenlunEval(true);
    else if (i === 1) shenlunEval(false);
  }

  // 学习记账：todayCount/stats/wrong/answeredOrder；温习模式不记账
  function recordResult(q, ok) {
    store.todayCount += 1;
    session.answeredThisRound[q.id] = 1;
    syncToday();
    if (session.mode === "daily") store.dailyDone[q.id] = 1; // 每日一学进度标记
    if (!store.stats[q.id]) store.stats[q.id] = { right: 0, wrong: 0 };
    if (ok) {
      store.stats[q.id].right += 1;
      session.rightCount += 1;
      var w = store.wrong[q.id];
      if (w) {
        w.lastPracticedAt = Date.now();
        w.rightStreak = (w.rightStreak || 0) + 1;
        if (w.rightStreak >= 3) delete store.wrong[q.id]; // 连续答到三次才销账
      }
    } else {
      store.stats[q.id].wrong += 1;
      var w0 = store.wrong[q.id];
      store.wrong[q.id] = {
        fails: (w0 ? w0.fails : 0) + 1,
        lastWrongAt: Date.now(),
        lastPracticedAt: Date.now(),
        rightStreak: 0 // 没答到清零连对计数
      };
    }
    store.answeredOrder.push(q.id);
    if (store.answeredOrder.length > 100) store.answeredOrder = store.answeredOrder.slice(-100);
    saveStore();
  }

  // 富文本渲染：把题库文本里的 "img/xxx.png" 引用替换为 <img> 懒加载，其余安全走 textContent
  // 纯文字题零开销（无引用时直接 textContent 一条路）
  // 下划线宽度统一（所有文本安全）：长短不一的既有下划线统一为四段式
  function undify(t) {
    return (t || "").replace(/_{3,}|＿{2,}/g, "____");
  }
  // 空白标准化（仅题干/选项）：挖空常被写成连续空格（HTML 渲染折叠后几乎不可见），统一显示为下划线。
  // 不可用于材料/解析/申论答案——那些文本里的连续 NBSP/全角空格是段落缩进，不是挖空
  function blankify(t) {
    return undify((t || "").replace(/[ \u00a0\u3000]{2,}/g, "____"));
  }
  window.__blankify = blankify; // 测试可见

  function setRichText(el, text) {
    text = undify(text);
    if (!/\bimg\/[\w.\-]+\.(png|jpe?g|gif|webp)\b/i.test(text || "")) {
      el.textContent = text || "";
      return;
    }
    el.textContent = "";
    var re = /(\bimg\/[\w.\-]+\.(?:png|jpe?g|gif|webp)\b)/gi;
    var last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var pic = document.createElement("img");
      pic.src = m[1];
      pic.alt = "题目图片";
      pic.loading = "lazy";
      pic.decoding = "async";
      pic.className = "q-img";
      el.appendChild(pic);
      last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }

  // 重遇学过的题：不用回显——申论学习流鼓励重新动笔，直接从「写完了，对照参考答案」重新开始

  function stampResult(correct) {
    var stamp = $("result-stamp");
    stamp.textContent = correct ? "✓" : "✗";
    stamp.className = "result-stamp " + (correct ? "ok" : "no");
    // 重触发盖章动画
    stamp.style.animation = "none";
    void stamp.offsetWidth;
    stamp.style.animation = "";
  }

  // ---------- 学习流：写完 → 对照参考答案 → 自评「答到了 / 没答到」 ----------
  // 对照参考答案：展示写作解析+参考答案，停下计时，进入自评态
  function shenlunPeek() {
    var q = session.current;
    if (!q || session.confirmed || session.peeked) return;
    session.peeked = true;
    clearInterval(session.timerId);
    var usedSec = Math.round((Date.now() - session.timerStart) / 1000);
    session.times.push(usedSec); // 对照过的题计入本轮统计（自评或跳过均算已学）

    showPendingStamp();
    $("result-meta").innerHTML = '对照上面的参考答案自评：采分点覆盖了七成以上吗？';
    renderKnowledgeAndAnalysis(q);

    $("result-area").hidden = false;
    $("btn-peek").hidden = true;
    $("btn-confirm").hidden = false;
    $("btn-miss").hidden = false;
    showNextBtn(); // 不自评直接下一题 = 跳过，不计成绩
    setTimeout(function () {
      var ra = $("result-area");
      if (ra && !ra.hidden && !views.quiz.hidden && session.current === q)
        ra.scrollIntoView({ behavior: ANIM ? "smooth" : "auto", block: "start" });
    }, 120);
  }

  // 自评：答到了=掌握 ✓ / 没答到=进重学本 ✗（连答到三次自动移出）
  function shenlunEval(ok) {
    var q = session.current;
    if (!q || session.confirmed || !session.peeked) return;
    session.confirmed = true;

    recordResult(q, ok);
    renderRoundStat();
    updateHomeBadge();
    stampResult(ok);

    // 连答到计数（本轮内）：庆祝节奏用
    session.streak = ok ? (session.streak || 0) + 1 : 0;
    buzzJudge(ok, session.streak);
    ding(ok);

    var meta = $("result-meta");
    meta.innerHTML = ok
      ? '自评「答到了」 · 已计入今日学习'
      : '自评「没答到」 · 已收录进重学本，连答到 3 次自动移出';

    $("btn-confirm").hidden = true;
    $("btn-miss").hidden = true;
    showNextBtn();
    // 答到自动下一题：留 0.6s 看一眼对勾就翻页（没答到不自动，静心看解析）
    if (ok && store.autoNext && session.index + 1 < session.queue.length) {
      clearTimeout(session.autoNextT);
      session.autoNextT = setTimeout(function () {
        try { nextQuestion(); } catch (e) { clearTimeout(session.autoNextT); }
      }, 600);
    }
  }

  // 申论解析/答案分离：把【参考答案】【参考提纲】小节从解析中抽出，单独成卡
  function splitShenlunAnalysis(text) {
    var guide = [], answer = [], target = guide;
    text.split(/(?=【)/).forEach(function (p) {
      var m = p.match(/^【([^】]+)】/);
      if (m && (m[1] === "参考答案" || m[1] === "参考提纲")) target = answer;
      else if (m) target = guide;
      target.push(p);
    });
    return { guide: guide.join("").trim(), answer: answer.join("").trim() };
  }

  // 渲染知识点笺与解析正文（申论：先「写作解析」教怎么写，再「参考答案」对照自评）
  function renderKnowledgeAndAnalysis(q) {
    var ka = $("knowledge-area");
    ka.innerHTML = "";
    kpsOf(q).forEach(function (kp, i) {
      var div = document.createElement("article");
      div.className = "qian qian-knowledge";
      var cn = CN_NUMS[i] || String(i + 1);
      div.innerHTML =
        '<div class="qian-label">知识点 ' + cn + '</div>' +
        '<div class="kp-title"></div>' +
        '<div class="kp-body"></div>';
      div.querySelector(".kp-title").textContent = kp.title;
      div.querySelector(".kp-body").textContent = kp.body;
      ka.appendChild(div);
    });
    var ansCard = $("shenlun-answer-card");
    var sp = splitShenlunAnalysis(q.analysis);
    setRichText($("analysis-body"), sp.guide);
    setRichText($("shenlun-answer-body"), sp.answer || "本题无独立参考答案小节，解析内已含要点。");
    ansCard.hidden = false;
    $("analysis-label").textContent = "写作解析";
    var note = $("analysis-note");
    note.textContent = q.note ? "备注：本题" + q.note : "";
    note.style.display = q.note ? "" : "none";
  }

  function showNextBtn() {
    var nextBtn = $("btn-next");
    nextBtn.hidden = false;
    nextBtn.textContent = session.index + 1 < session.queue.length
      ? "下一题"
      : (session.mode === "single" ? "完成" : session.times.length ? "完成，查看报告" : "完成，返回列表");
  }

  function showPendingStamp() {
    var stamp = $("result-stamp");
    stamp.textContent = "阅";
    stamp.className = "result-stamp pending";
    stamp.style.animation = "none";
    void stamp.offsetWidth;
    stamp.style.animation = "";
  }

  // ---------- 温习模式：参考答案+解析直出，不计成绩不记账，适合隔天回看 ----------
  function reciteShow(q) {
    session.confirmed = true; // 锁定，温习中不可自评
    showPendingStamp();
    $("result-meta").innerHTML = '温习模式：参考答案直接展示，不计成绩 · 重读材料对照要点加深印象';
    renderKnowledgeAndAnalysis(q);
    $("result-area").hidden = false;
    $("btn-confirm").hidden = true;
    $("btn-miss").hidden = true;
    $("btn-peek").hidden = true;
    var nextBtn = $("btn-next");
    nextBtn.hidden = false;
    nextBtn.textContent = session.index + 1 < session.queue.length
      ? "下一题"
      : "完成，返回题目列表";
  }

  function nextQuestion() {
    clearTimeout(session.autoNextT);
    if (session.index + 1 < session.queue.length) {
      pageTo(1);
    } else if (session.mode === "recite" || session.mode === "single" || session.times.length === 0) {
      // 温习模式/单题分享/纯浏览（全程没对照过答案）：学完直接回来源页，不出学习报告
      clearInterval(session.timerId);
      backToOrigin();
      toast(session.mode === "recite" ? "温习完成，记得隔天再自评一遍"
        : session.mode === "single" ? "本题学习完成，可继续搜其他题"
        : "学习完成");
    } else {
      clearInterval(session.timerId);
      renderSummary();
    }
  }

  // 返回进入答题前的页面（卷目 → 卷目并刷新状态；错题本 → 错题本；收藏本 → 收藏本；其余 → 首页）
  function backToOrigin() {
    clearInterval(session.timerId);
    clearTimeout(session.autoNextT);
    clearTimeout(pageTimer);
    if (QCARD) QCARD.classList.remove("page-out-left", "page-out-right", "page-in-left", "page-in-right");
    saveCurrentNote();
    var from = session.from || "home";
    session.from = "home";
    if (from === "catalog" && CAT_MOD) {
      renderCatalog();
      showView("catalog", true);
    } else if (from === "wrong") {
      renderWrongBook();
      showView("wrong", true);
    } else if (from === "fav") {
      renderFavBook();
      showView("fav", true);
    } else if (from === "search") {
      showView("search", true); // 回到搜题页，结果列表还在，可直接点下一道
    } else {
      goHome(true);
    }
  }

  // ---------- 结课小结 ----------
  function goHome(keepScroll) {
    clearInterval(session.timerId);
    clearTimeout(session.autoNextT);
    clearTimeout(pageTimer);
    if (!views.quiz.hidden) saveCurrentNote();
    session.from = "home";
    showView("home", keepScroll);
    renderHome();
    // renderHome 重渲染在 showView 滚动之后，回首页时再校准一次记忆位置（瞬时，不动画）
    if (keepScroll && scrollMemo.home && document.documentElement) {
      var prevB = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, scrollMemo.home);
      document.documentElement.style.scrollBehavior = prevB;
    }
  }

  // 庆祝彩带：纯 CSS 下落粒子（ANIM 关闭/reduced-motion 时跳过），2.8s 后自清理
  function confetti() {
    if (!ANIM) return;
    try {
      var layer = document.createElement("div");
      layer.className = "confetti-layer";
      var colors = ["#3d6ef7", "#2fd392", "#ffb648", "#ff7a7a", "#2fd4c8", "#6b93f8"];
      for (var i = 0; i < 42; i++) {
        var p = document.createElement("i");
        p.className = "confetti-i";
        p.style.left = Math.round(Math.random() * 100) + "%";
        p.style.background = colors[i % colors.length];
        p.style.setProperty("--d", (2 + Math.random() * 1.2).toFixed(2) + "s");
        p.style.setProperty("--dl", (Math.random() * 0.5).toFixed(2) + "s");
        p.style.setProperty("--r", Math.round((Math.random() - 0.5) * 720) + "deg");
        if (Math.random() > 0.5) p.style.borderRadius = "50%";
        layer.appendChild(p);
      }
      document.body.appendChild(layer);
      setTimeout(function () {
        try { document.body.removeChild(layer); } catch (e) {}
      }, 3000);
    } catch (e) {}
  }

  function renderSummary() {
    var n = session.times.length; // 实际作答题数（滑动跳过的题不计）
    var right = session.rightCount;
    var wrongN = n - right;
    var totalSec = session.times.reduce(function (a, b) { return a + b; }, 0);
    var avg = n ? Math.round(totalSec / n) : 0;

    setQuizChrome(false);

    var stamp = $("summary-stamp");
    var rate0 = n ? right / n : 0;
    var pct = Math.round(rate0 * 100);
    stamp.style.setProperty("--p", pct);
    stamp.innerHTML = "<span>" + pct + "%</span>";
    stamp.className = "summary-stamp" + (right === n ? " gold" : "");
    stamp.style.animation = "none";
    void stamp.offsetWidth;
    stamp.style.animation = "";

    var modeName = session.mode === "mixed" ? "随机学习"
      : session.mode === "daily" ? "每日一学"
      : (session.mode === "wrong" ? "重学练习"
      : session.mode === "fav" ? "收藏学习"
      : (VOLUME_SHORT[session.moduleId] || "专项") + "专项学习");
    $("summary-title").textContent = modeName + " · 本轮 " + n + " 题";

    function ovItem(cls, num, unit, label) {
      return '<div class="ov-item ' + cls + '"><div class="ov-num">' + num +
        (unit ? '<span class="unit">' + unit + '</span>' : "") +
        '</div><div class="ov-label">' + label + "</div></div>";
    }
    $("summary-grid").innerHTML =
      ovItem("", right, "题", "答到") +
      ovItem("", wrongN, "题", "没答到") +
      ovItem("acc", avg, "秒", "平均每题") +
      ovItem("streak", store.todayCount, "题", "今日已学");

    // 仪式感：发挥好（≥3 题且答到率 ≥80%）→ 庆祝震动 + 彩带
    if (n >= 3 && rate0 >= 0.8) {
      buzz([40, 60, 40, 60, 120]);
      confetti();
    }

    var rate = n ? right / n : 0;
    var comment;
    if (right === n) comment = "全部答到，采分点抓得很准，继续保持！";
    else if (rate >= 0.8) comment = "表现不错，答到率很高，继续保持。";
    else if (rate >= 0.6) comment = "整体不错，把没答到的题弄懂就能更进一步。";
    else comment = "别灰心，没答到的题就是提升点，按方法课的失分八维自查表归因后重学。";
    if (wrongN > 0) comment += " 已收录进重学本。";
    $("summary-comment").textContent = comment;
  }

  function quitQuiz() {
    backToOrigin();
    toast("已学习 " + store.todayCount + " 题，继续加油！");
  }

  // 退出保护：本轮已学 ≥5 题且报告未出时，误触退出需确认（防手滑丢整轮）
  function confirmQuitIfNeeded() {
    try {
      var sw = $("summary-wrap");
      if (!views.quiz.hidden && sw && sw.hidden !== false && session.times && session.times.length >= 5) {
        return confirm("本轮已学 " + session.times.length + " 题，确定退出吗？退出后本轮不会生成报告");
      }
    } catch (e) {}
    return true;
  }
  // ---------- 首页 ----------
  // 考试范围切换条：范围无题时隐藏胶囊，避免误入空题库
  function renderScopeBar() {
    var bar = $("scope-bar");
    if (!bar) return;
    var counts = {};
    ALL_QUESTIONS.forEach(function (q) { var e = examOf(q); counts[e] = (counts[e] || 0) + 1; });
    var any = counts.tianjin > 0;
    bar.hidden = !any;
    if (!any) return;
    $("scope-guokao").hidden = counts.guokao === 0;
    $("scope-tianjin").hidden = counts.tianjin === 0;
    var cur = scopeExam();
    $("scope-guokao").classList.toggle("on", cur === "guokao");
    $("scope-tianjin").classList.toggle("on", cur === "tianjin");
    [["guokao", "scope-guokao"], ["tianjin", "scope-tianjin"]].forEach(function (entry) {
      $(entry[1]).setAttribute("aria-pressed", entry[0] === cur ? "true" : "false");
    });
  }

  function switchScope(ex) {
    if (scopeExam() === ex) return;
    store.examScope = ex;
    saveStore();
    renderHome();
    toast(ex === "tianjin" ? "已切换到天津市考申论" : "已切换到国考申论");
  }

  function renderHome() {
    renderScopeBar();
    renderOverview();
    renderDailyCard();

    var box = $("module-cards");
    box.innerHTML = "";
    VOLUMES.forEach(function (m) {
      var qs = scopedPool().filter(function (q) { return volumeOf(q) === m.key; });
      var total = qs.length;
      if (total === 0) return; // 当前范围无此卷时不渲染
      var done = 0, right = 0, wrong = 0, wrongN = 0;
      qs.forEach(function (q) {
        var s = store.stats[q.id];
        if (s) {
          done += 1;
          right += s.right;
          wrong += s.wrong;
        }
        if (store.wrong[q.id]) wrongN += 1;
      });

      var acc = (right + wrong) > 0
        ? '<span class="accuracy">答到率 ' + Math.round(right * 100 / (right + wrong)) + "%</span>"
        : "";
      var card = document.createElement("button");
      card.type = "button";
      card.className = "module-card";
      card.innerHTML =
        '<div class="module-zi">' + m.zi + "</div>" +
        '<div class="module-name">' + m.name + "</div>" +
        '<div class="module-desc">' + m.desc + "</div>" +
        '<div class="module-meta"><span>共 ' + total + " 题 · 已学 " + done + "</span>" +
        acc +
        (wrongN ? '<span class="has-wrong">待重学 ' + wrongN + " 道</span>" : "<span>　</span>") +
        "</div>" +
        '<div class="module-bar"><i style="width:' + Math.round(done * 100 / total) + '%"></i></div>';
      card.title = m.name + "：共 " + total + " 题，已学 " + done + " 题 · 查看题目列表";
      card.addEventListener("click", function () { openCatalog(m.key); });
      box.appendChild(card);
    });

    updateHomeBadge();
  }

  function updateHomeBadge() {
    renderTabbar(Object.keys(views).filter(function (k) { return !views[k].hidden; })[0]);
    var ex = scopeExam();
    var n = Object.keys(store.wrong).filter(function (id) {
      var q = ALL_QUESTIONS.find(function (x) { return x.id === id; });
      return q && examOf(q) === ex;
    }).length;
    var badge = $("wrong-badge");
    badge.textContent = n;
    badge.hidden = n === 0;
    var f = Object.keys(store.favorites || {}).filter(function (id) {
      var q = ALL_QUESTIONS.find(function (x) { return x.id === id; });
      return q && examOf(q) === ex;
    }).length;
    var fb = $("fav-badge");
    fb.textContent = f;
    fb.hidden = f === 0;
  }

  // ---------- 统计页：每日做题量 + 累计 ----------
  var WEEK_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

  function renderStats() {
    // 近 7 天柱状图（含今天）
    var week = $("stats-week");
    week.innerHTML = "";
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d);
    }
    var max = 1;
    days.forEach(function (d) {
      var c = store.days[fmtDate(d)] || 0;
      if (c > max) max = c;
    });
    days.forEach(function (d) {
      var c = store.days[fmtDate(d)] || 0;
      var col = document.createElement("div");
      col.className = "st-col" + (c ? "" : " zero") + (fmtDate(d) === todayStr ? " today" : "");
      col.innerHTML =
        '<span class="st-num">' + (c || "") + "</span>" +
        '<span class="st-bar"><i style="height:' + Math.max(4, Math.round(c * 100 / max)) + '%"></i></span>' +
        '<span class="st-day">' + (fmtDate(d) === todayStr ? "今" : WEEK_LABEL[d.getDay()]) + "</span>";
      week.appendChild(col);
    });

    // 累计：历史总做题次数 / 累计天数 / 总正确率（全范围合并，不只当前范围）
    var totalDone = 0, activeDays = 0, right = 0, wrong = 0;
    Object.keys(store.days).forEach(function (k) {
      if (store.days[k] > 0) activeDays += 1;
      totalDone += store.days[k];
    });
    Object.keys(store.stats).forEach(function (id) {
      right += store.stats[id].right;
      wrong += store.stats[id].wrong;
    });
    var acc = (right + wrong) > 0 ? Math.round(right * 100 / (right + wrong)) + "%" : "—";
    function item(cls, html, label) {
      return '<div class="ov-item ' + cls + '"><div class="ov-num">' + html +
        '</div><div class="ov-label">' + label + "</div></div>";
    }
    $("stats-total").innerHTML =
      item("", totalDone + '<span class="unit">题</span>', "累计练习") +
      item("", activeDays + '<span class="unit">天</span>', "活跃天数") +
      item("acc", acc, "总正确率");

    // 卷别掌握度：各卷答到率横条（当前考试范围），最低且 <80% 标「薄弱」，点击直达卷目
    var mBox = $("stats-mastery");
    if (mBox) {
      mBox.innerHTML = "";
      var weakest = null;
      var rows = [];
      VOLUMES.forEach(function (m) {
        var r = 0, w = 0, attempted = 0, totalQ = 0;
        scopedPool().forEach(function (q) {
          if (volumeOf(q) !== m.key) return;
          totalQ += 1;
          var s = store.stats[q.id];
          if (s) { attempted += 1; r += s.right; w += s.wrong; }
        });
        if (totalQ === 0) return; // 当前范围无此卷（如国考范围不显示天津卷）
        var tot = r + w;
        var acc = tot ? Math.round(r * 100 / tot) : -1;
        if (acc >= 0 && (!weakest || acc < weakest.acc)) weakest = { key: m.key, acc: acc };
        rows.push({ zi: m.zi, name: m.name, key: m.key, acc: acc, attempted: attempted });
      });
      rows.forEach(function (row) {
        var el = document.createElement("button");
        el.className = "mastery-row" + (row.acc >= 0 && row.acc < 60 ? " weak" : "");
        el.innerHTML =
          '<span class="ma-zi">' + row.zi + '</span>' +
          '<span class="ma-name">' + row.name + '</span>' +
          '<span class="ma-bar"><i style="width:' + (row.acc < 0 ? 0 : row.acc) + '%"></i></span>' +
          '<span class="ma-acc">' + (row.acc < 0 ? "未测" : row.acc + "%") + '</span>' +
          (weakest && row.key === weakest.key && weakest.acc < 80 ? '<span class="ma-weak">薄弱</span>' : '');
        el.title = row.name + "掌握度 " + (row.acc < 0 ? "未测" : row.acc + "%") + " · 点击查看题目列表";
        el.addEventListener("click", function () { openCatalog(row.key); });
        mBox.appendChild(el);
      });
      if (!weakest) {
        var tip = document.createElement("div");
        tip.className = "empty-tip";
        tip.textContent = "还没有分卷的学习记录，先去学几题就能看到掌握度";
        mBox.appendChild(tip);
      }
    }

    // 活跃月份：每月做题量（小圆点热力风格，简洁列示）
    var months = {};
    Object.keys(store.days).forEach(function (k) {
      if (store.days[k] > 0) {
        var mk = k.slice(0, 7);
        months[mk] = (months[mk] || 0) + store.days[k];
      }
    });
    var mBox = $("stats-months");
    mBox.innerHTML = "";
    var mk = Object.keys(months).sort();
    var maxMonth = Math.max.apply(null, mk.map(function (key) { return months[key]; }).concat(1));
    if (!mk.length) {
      mBox.innerHTML = '<div class="empty-tip">还没有练习记录，去首页做题吧</div>';
    } else {
      mk.forEach(function (k) {
        var row = document.createElement("div");
        row.className = "st-month";
        row.innerHTML = '<span class="stm-name">' + k + '</span><span class="stm-bar"><i style="width:' +
          Math.max(6, Math.round(months[k] * 100 / maxMonth)) +
          '%"></i></span><span class="stm-num">' + months[k] + " 题</span>";
        mBox.appendChild(row);
      });
    }
  }

  function renderOverview() {
    var pool = scopedPool();
    var done = 0, right = 0, wrong = 0;
    pool.forEach(function (q) {
      var s = store.stats[q.id];
      if (s) {
        done += 1;
        right += s.right;
        wrong += s.wrong;
      }
    });
    var acc = (right + wrong) > 0 ? Math.round(right * 100 / (right + wrong)) + "%" : "—";

    function item(cls, html, label) {
      return '<div class="ov-item ' + cls + '"><div class="ov-num">' + html +
        '</div><div class="ov-label">' + label + "</div></div>";
    }
    $("overview").innerHTML =
      item("", pool.length + '<span class="unit">题</span>', "题库总量") +
      item("", done + '<span class="unit">题</span>', "已做题数") +
      item("acc", acc, "总正确率");

    renderPunchStrip();
  }

  // 首页打卡条：今日已练 + 连续天数（断一天即断签，重新计）
  function streakDays() {
    var n = 0;
    var d = new Date();
    // 今天还没练：从昨天起算连续（今天不计数，保持激励）；今天已练：从今天起算
    if (!(store.days[fmtDate(d)] > 0)) d.setDate(d.getDate() - 1);
    while (store.days[fmtDate(d)] > 0) {
      n += 1;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function renderPunchStrip() {
    var strip = $("punch-strip");
    if (!strip) return;
    var n = store.todayCount;
    var goal = 30;
    var streak = streakDays();
    strip.hidden = false;
    strip.innerHTML =
      '<span class="punch-item">今日已练 <b>' + n + '</b> 题</span>' +
      '<span class="punch-bar"><i style="width:' + Math.min(100, Math.round(n * 100 / goal)) + '%"></i></span>' +
      '<span class="punch-item">' + (streak >= 3 ? FLAME_SVG : '') + '连续 <b>' + streak + '</b> 天</span>';
  }

  // ---------- 卷目（模块总览） ----------
  var CAT_MOD = null;

  function openCatalog(modKey) {
    CAT_MOD = modKey;
    renderCatalog();
    showView("catalog");
  }

  function renderCatalog() {
    var m = null;
    VOLUMES.forEach(function (x) { if (x.key === CAT_MOD) m = x; });
    var qs = scopedPool().filter(function (q) { return volumeOf(q) === CAT_MOD; });
    var done = 0;
    qs.forEach(function (q) { if (store.stats[q.id]) done += 1; });

    $("catalog-title").textContent = (m ? m.zi + " · " : "") + (m ? m.name : (VOLUME_SHORT[CAT_MOD] || "申论")) + "题目列表";
    $("btn-cat-practice").textContent = "顺序学习";
    $("btn-sl-guide").hidden = !m; // 有卷别时展示零基础指南入口
    $("btn-cat-recite").hidden = false;
    var drawBar = $("cat-draw-bar");
    if (drawBar) drawBar.hidden = false;
    $("catalog-tip").textContent = "共 " + qs.length + " 题 · 已学 " + done + " 题 · 点击题目从该题开始学习，左右滑动切换";

    var list = $("catalog-list");
    list.innerHTML = "";
    // 按卷别分组（剥离 source 里的题号后缀，如「· 第61题」）；保持题库引入顺序即年份序
    var groups = [];
    var bySource = {};
    qs.forEach(function (q) {
      var src = (q.source || "其他").replace(/·?\s*第\d+题/g, "").trim() || "其他";
      if (!bySource[src]) {
        bySource[src] = { source: src, questions: [] };
        groups.push(bySource[src]);
      }
      bySource[src].questions.push(q);
    });

    var no = 0;
    groups.forEach(function (g) {
      var gDone = 0;
      g.questions.forEach(function (q) { if (store.stats[q.id]) gDone += 1; });
      var head = document.createElement("div");
      head.className = "ct-group";
      head.innerHTML = '<span class="ct-src">' + g.source + '</span><span class="ct-prog">' +
        gDone + " / " + g.questions.length + "</span>";
      list.appendChild(head);

      g.questions.forEach(function (q) {
        no += 1;
        var s = store.stats[q.id];
        var inWrong = !!store.wrong[q.id];
        var state = !s ? "none" : (inWrong || s.wrong > 0 ? "no" : "ok");
        var sealText = state === "none" ? "未学" : state === "ok" ? "答到" : "待重学";
        var risky = s && s.wrong >= 2;

        var row = document.createElement("button");
        row.className = "ct-row" + (state === "none" ? " undone" : "");
        row.innerHTML =
          '<span class="ct-no">' + no + "</span>" +
          '<span class="ct-text"></span>' +
          (risky ? '<span class="ct-chip risky">待重学</span>' : "") +
          '<span class="ct-seal ' + state + '">' + sealText + "</span>";
        row.querySelector(".ct-text").textContent =
          blankify(q.question).replace(/\s+/g, " ").slice(0, 42) + (q.question.length > 42 ? "……" : "");
        row.title = q.source + " · " + (state === "none" ? "未学" : state === "ok" ? "已答到" : "没答到待重学");
        row.addEventListener("click", function () {
          var idx = qs.indexOf(q);
          startQuiz("module", CAT_MOD, { startIndex: idx, from: "catalog" });
        });
        list.appendChild(row);
      });
    });
  }

  // ---------- 错题本 ----------
  function renderWrongBook() {
    var list = $("wrong-list");
    list.innerHTML = "";
    var ids = Object.keys(store.wrong);
    var ex = scopeExam();
    ids = ids.filter(function (id) {
      var q = ALL_QUESTIONS.find(function (x) { return x.id === id; });
      return q && examOf(q) === ex;
    });
    if (ids.length === 0) {
      list.innerHTML = '<div class="empty-tip empty-tip-rich">当前考试范围还没有待重学的题。自评「没答到」的题会自动收录，连答到 3 次自动移出。</div>';
      var action = document.createElement("button");
      action.className = "ink-btn empty-action";
      action.textContent = "去随机学习";
      action.addEventListener("click", function () { startQuiz("mixed"); });
      list.appendChild(action);
      return;
    }
    ids.forEach(function (id) {
      var q = ALL_QUESTIONS.find(function (x) { return x.id === id; });
      if (!q) return;
      if (examOf(q) !== ex) return; // 只显示当前范围的错题
      var w = store.wrong[id];
      var kps = kpsOf(q);
      var item = document.createElement("div");
      item.className = "wrong-item";
      item.innerHTML =
        '<span class="wi-seal">✗' + w.fails + "</span>" +
        '<span class="wi-main"><span class="wi-module">' + (VOLUME_SHORT[volumeOf(q)] || "申论") + " · " + q.source + "</span>" +
        '<span class="wi-text"></span>' +
        '<span class="wi-meta">没答到 ' + w.fails + " 次 · 连答到 " + (w.rightStreak || 0) + "/3 · 最近 " + fmtRel(w.lastWrongAt) +
        (w.fails >= 2 ? '<span class="kp">待重学</span>' : "") +
        (kps.length && w.fails < 2 ? '<span class="kp">' + kps[0].title + "</span>" : "") +
        "</span></span>" +
        '<button class="wi-rep">重学</button>' +
        '<button class="wi-del" title="移出重学本" aria-label="移出重学本">✕</button>';
      item.querySelector(".wi-text").textContent = blankify(q.question).replace(/\s+/g, " ").slice(0, 60) + "……";
      item.querySelector(".wi-rep").addEventListener("click", function () {
        // 从该错题开始，按错题列表顺序连练
        var pool = scopedPool().filter(function (x) { return store.wrong[x.id]; });
        var idx = pool.findIndex(function (x) { return x.id === id; });
        startQuiz("wrong", null, { startIndex: idx < 0 ? 0 : idx, from: "wrong" });
      });
      item.querySelector(".wi-del").addEventListener("click", function () {
        if (!confirm("确定将这道题移出重学本吗？")) return;
        delete store.wrong[id];
        saveStore();
        renderWrongBook();
        updateHomeBadge();
      });
      list.appendChild(item);
    });
  }

  // ---------- 收藏本 ----------
  function renderFavBook() {
    var list = $("fav-list");
    list.innerHTML = "";
    var ids = Object.keys(store.favorites);
    var ex = scopeExam();
    ids = ids.filter(function (id) {
      var q = ALL_QUESTIONS.find(function (x) { return x.id === id; });
      return q && examOf(q) === ex;
    });
    if (ids.length === 0) {
      list.innerHTML = '<div class="empty-tip">当前考试范围还没有收藏题，学习时点 ☆ 即可收藏想重练的题。</div>';
      return;
    }
    ids.forEach(function (id) {
      var q = ALL_QUESTIONS.find(function (x) { return x.id === id; });
      if (!q) return;
      if (examOf(q) !== ex) return; // 只显示当前范围的收藏
      var item = document.createElement("div");
      item.className = "wrong-item fav-item";
      item.innerHTML =
        '<span class="wi-seal fav">★</span>' +
        '<span class="wi-main"><span class="wi-module">' + (VOLUME_SHORT[volumeOf(q)] || "申论") + " · " + q.source + "</span>" +
        '<span class="wi-text"></span>' +
        (store.notes[id] ? '<span class="wi-meta">有备注</span>' : "") +
        "</span>" +
        '<button class="wi-rep">重学</button>' +
        '<button class="wi-del" title="取消收藏" aria-label="取消收藏">✕</button>';
      item.querySelector(".wi-text").textContent = blankify(q.question).replace(/\s+/g, " ").slice(0, 60) + "……";
      item.querySelector(".wi-rep").addEventListener("click", function () {
        var pool = scopedPool().filter(function (x) { return store.favorites[x.id]; });
        var idx = pool.findIndex(function (x) { return x.id === id; });
        startQuiz("fav", null, { startIndex: idx < 0 ? 0 : idx, from: "fav" });
      });
      item.querySelector(".wi-del").addEventListener("click", function () {
        if (!confirm("确定取消收藏这道题吗？")) return;
        delete store.favorites[id];
        saveStore();
        renderFavBook();
        updateHomeBadge();
      });
      list.appendChild(item);
    });
  }

  // ---------- 键盘快捷键 ----------
  document.addEventListener("keydown", function (e) {
    // 卷目页：Esc 回书房
    if (!views.catalog.hidden) {
      if (e.key === "Escape") { e.preventDefault(); showView("home"); }
      return;
    }
    // 搜题页：Esc 回首页
    if (!views.search.hidden) {
      if (e.key === "Escape") { e.preventDefault(); showView("home", true); }
      return;
    }
    if (views.quiz.hidden) return;
    if (e.target && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.target.tagName === "BUTTON" || e.target.isContentEditable)) return;
    // 结课小结页：回车/ESC 回书房
    if (!$("summary-wrap").hidden) {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        e.preventDefault();
        goHome();
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!session.confirmed) {
        if (!session.peeked) shenlunPeek(); // 回车：写完对照参考答案
        else nextQuestion(); // 已对照未自评：回车直接下一题（跳过不计）
      } else {
        nextQuestion();
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      prevQuestion();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      browseNext();
    } else if (e.key === "1") {
      shenlunEval(true); // 键盘 1：自评答到了
    } else if (e.key === "2") {
      shenlunEval(false); // 键盘 2：自评没答到
    } else if (e.key === "Escape") {
      goBack();
    }
  });

  // ---------- 触屏滑动切题 ----------
  var touchX = 0, touchY = 0;
  views.quiz.addEventListener("touchstart", function (e) {
    if (!e.touches || !e.touches[0]) return;
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  views.quiz.addEventListener("touchend", function (e) {
    var t = (e.changedTouches && e.changedTouches[0]) || null;
    if (!t) return;
    if (e.target && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")) return; // 备注输入区不切题
    var dx = t.clientX - touchX;
    var dy = t.clientY - touchY;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) pageTo(1); else pageTo(-1); // 左滑下一题，右滑上一题
    }
  }, { passive: true });

  // ---------- 事件绑定 ----------
  $("btn-back").addEventListener("click", goBack);
  $("btn-home").addEventListener("click", function () {
    if (!views.quiz.hidden && !confirmQuitIfNeeded()) return;
    goHome();
  });
  $("btn-home2").addEventListener("click", goHome);
  $("btn-again").addEventListener("click", function () {
    // 抽题练习按同题量重抽（否则模块模式会变成通练整卷）；其他模式行为不变
    startQuiz(session.mode, session.moduleId, { pick: session.pickCount, from: session.from });
  });
  $("btn-mixed").addEventListener("click", function () { startQuiz("mixed"); });

  // 随机学习题量选择（3/5/10）
  function renderMixBar() {
    var n = store.mixCount || 3;
    [3, 5, 10].forEach(function (v) {
      var pill = $("mix-pill-" + v);
      if (pill) {
        pill.classList.toggle("on", v === n);
        pill.setAttribute("aria-pressed", v === n ? "true" : "false");
      }
    });
    var sub = $("mixed-sub");
    if (sub) sub.textContent = "全卷随机抽 " + n + " 题";
  }
  [3, 5, 10].forEach(function (v) {
    var pill = $("mix-pill-" + v);
    if (pill) pill.addEventListener("click", function () {
      store.mixCount = v;
      saveStore();
      renderMixBar();
    });
  });
  renderMixBar();
  $("btn-wrongbook").addEventListener("click", function () {
    showView("wrong");
    renderWrongBook();
  });
  $("btn-repractice").addEventListener("click", function () { startQuiz("wrong", null, { from: "wrong" }); });
  $("btn-favbook").addEventListener("click", function () {
    showView("fav");
    renderFavBook();
  });
  $("btn-fav-practice").addEventListener("click", function () { startQuiz("fav", null, { from: "fav" }); });
  $("btn-clear-fav").addEventListener("click", function () {
    if (Object.keys(store.favorites).length === 0) { toast("收藏本已经是空的"); return; }
    if (confirm("确定清空收藏本吗？")) {
      store.favorites = {};
      saveStore();
      renderFavBook();
      updateHomeBadge();
      toast("已清空收藏本");
    }
  });
  $("btn-cat-practice").addEventListener("click", function () {
    if (CAT_MOD) startQuiz("module", CAT_MOD, { from: "catalog" });
  });
  // 卷别抽题学习：从当前卷别随机抽 3/5/10 题（智能抽题：待重学隔期优先，近期学过的不出）
  [3, 5, 10].forEach(function (n) {
    $("cat-pill-" + n).addEventListener("click", function () {
      if (!CAT_MOD) return;
      var qn = scopedPool().filter(function (q) { return volumeOf(q) === CAT_MOD; }).length;
      var take = Math.min(n, qn);
      if (qn === 0) { toast("该卷暂时没有题目"); return; }
      if (qn < n) toast("该卷仅 " + qn + " 题，全部抽入");
      startQuiz("module", CAT_MOD, { from: "catalog", pick: take });
    });
  });
  $("btn-cat-recite").addEventListener("click", function () {
    if (CAT_MOD) startQuiz("recite", CAT_MOD, { from: "catalog" });
  });
  $("daily-card").addEventListener("click", function () {
    startQuiz("daily", null, { from: "home" });
  });

  // ---------- 体验偏好：震动反馈 / 深色模式（V3.24.0） ----------
  var mqDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function darkNow() {
    if (store.darkMode === "on") return true;
    if (store.darkMode === "off") return false;
    return !!(mqDark && mqDark.matches);
  }
  function applyDark() {
    document.documentElement.classList.toggle("dark", darkNow());
  }
  var FS_LABEL = { md: "标准", lg: "大", xl: "特大" };
  var THEME_ORDER = ["blue", "green", "purple", "orange", "pink"];
  var THEME_LABEL = { blue: "蓝", green: "绿", purple: "紫", orange: "橙", pink: "粉" };
  function applyTheme() {
    var dc = document.documentElement.classList;
    THEME_ORDER.forEach(function (t) {
      if (t !== "blue") dc.toggle("t-" + t, store.theme === t);
    });
  }
  function applyFont() {
    var dc = document.documentElement.classList;
    dc.toggle("fs-lg", store.fontScale === "lg");
    dc.toggle("fs-xl", store.fontScale === "xl");
  }
  function renderPrefs() {
    var h = $("tg-haptic"), d = $("tg-dark");
    if (h) {
      h.textContent = store.haptic ? "开" : "关";
      h.setAttribute("aria-pressed", store.haptic ? "true" : "false");
      h.classList.toggle("pref-on", store.haptic);
    }
    if (d) {
      d.textContent = store.darkMode === "auto" ? "跟随" : (store.darkMode === "on" ? "开" : "关");
      d.setAttribute("aria-pressed", darkNow() ? "true" : "false");
      d.classList.toggle("pref-on", darkNow());
    }
    var f = $("tg-font");
    if (f) {
      f.textContent = FS_LABEL[store.fontScale] || "标准";
      f.setAttribute("aria-pressed", store.fontScale !== "md" ? "true" : "false");
      f.classList.toggle("pref-on", store.fontScale !== "md");
    }
    var th = $("tg-theme");
    if (th) {
      th.textContent = THEME_LABEL[store.theme] || "蓝";
      th.setAttribute("aria-pressed", store.theme !== "blue" ? "true" : "false");
      th.classList.toggle("pref-on", store.theme !== "blue");
    }
    var mx = $("tg-mix");
    if (mx) {
      mx.textContent = (store.mixCount || 3) + " 题";
      mx.setAttribute("aria-pressed", (store.mixCount || 3) !== 3 ? "true" : "false");
      mx.classList.toggle("pref-on", (store.mixCount || 3) !== 3);
    }
    var an = $("tg-autonext");
    if (an) {
      an.textContent = store.autoNext ? "开" : "关";
      an.setAttribute("aria-pressed", store.autoNext ? "true" : "false");
      an.classList.toggle("pref-on", store.autoNext);
    }
    var sd = $("tg-sound");
    if (sd) {
      sd.textContent = store.sound ? "开" : "关";
      sd.setAttribute("aria-pressed", store.sound ? "true" : "false");
      sd.classList.toggle("pref-on", store.sound);
    }
    // 后台定时通知需要服务端推送，当前本地版不提供误导性的开关。
    $("tg-notify").hidden = true;
    $("btn-notify-cancel").hidden = true;
    var av = $("about-ver");
    if (av) {
      var m = location && /\?v=([0-9.]+)/.test(location.href || "") ? RegExp.$1 : "";
      av.textContent = m || (document.querySelector('script[src*="app.js"]') && /[?&]v=([^&]+)/.test(document.querySelector('script[src*="app.js"]').src) ? RegExp.$1 : "") || ($("app-ver") && $("app-ver").textContent) || "—";
    }
  }
  $("tg-haptic").addEventListener("click", function () {
    store.haptic = !store.haptic;
    saveStore();
    renderPrefs();
    if (store.haptic) buzz(20);
    toast(store.haptic ? "震动反馈已开启" : "震动反馈已关闭");
  });
  $("tg-dark").addEventListener("click", function () {
    // 三态循环：跟随 → 开 → 关 → 跟随
    store.darkMode = store.darkMode === "auto" ? "on" : (store.darkMode === "on" ? "off" : "auto");
    saveStore();
    applyDark();
    renderPrefs();
    toast(store.darkMode === "auto" ? "深色模式：跟随系统" : (store.darkMode === "on" ? "深色模式：常开" : "深色模式：常关"));
  });
  $("tg-font").addEventListener("click", function () {
    // 三档循环：标准 → 大 → 特大 → 标准
    store.fontScale = store.fontScale === "md" ? "lg" : (store.fontScale === "lg" ? "xl" : "md");
    saveStore();
    applyFont();
    renderPrefs();
    toast("题干字号：" + (FS_LABEL[store.fontScale] || "标准"));
  });
  $("tg-theme").addEventListener("click", function () {
    // 五色循环：蓝 → 绿 → 紫 → 橙 → 粉 → 蓝
    var i = THEME_ORDER.indexOf(store.theme);
    store.theme = THEME_ORDER[(i + 1) % THEME_ORDER.length] || "blue";
    saveStore();
    applyTheme();
    renderPrefs();
    toast("界面色调：" + (THEME_LABEL[store.theme] || "蓝"));
  });
  $("tg-sound").addEventListener("click", function () {
    store.sound = !store.sound;
    saveStore();
    renderPrefs();
    if (store.sound) ding(true); // 立即试听
    toast(store.sound ? "自评音效已开启" : "自评音效已关闭");
  });
  $("tg-autonext").addEventListener("click", function () {
    store.autoNext = !store.autoNext;
    saveStore();
    renderPrefs();
    toast(store.autoNext ? "答到自动下一题已开启" : "答到自动下一题已关闭");
  });
  $("tg-mix").addEventListener("click", function () {
    // 三档循环：3 → 5 → 10 → 3
    store.mixCount = (store.mixCount || 3) === 3 ? 5 : ((store.mixCount || 3) === 5 ? 10 : 3);
    saveStore();
    renderPrefs();
    renderMixBar();
    toast("随机学习题量：" + store.mixCount + " 题");
  });
  if (mqDark && mqDark.addEventListener) mqDark.addEventListener("change", function () { applyDark(); renderPrefs(); });
  applyDark();
  applyFont();
  applyTheme();
  renderPrefs();

  // ---------- 新版本提示：SW 更新就绪后引导刷新（首次安装不提示） ----------
  if ("serviceWorker" in navigator) {
    try {
      // 页面自身版本：从 app.js 的 ?v= 参数取（构建时注入，与 sw.js 的 CACHE 版本一致）
      var pageVer = "";
      var appScript = document.querySelector('script[src*="app.js"]');
      if (appScript && /[?&]v=([^&]+)/.test(appScript.src)) pageVer = RegExp.$1;
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg) return;
        function showUpdateBar() {
          if (document.querySelector(".update-bar")) return;
          try {
            var bar = document.createElement("div");
            bar.className = "update-bar";
            bar.textContent = "发现新版本，点击刷新";
            bar.addEventListener("click", function () { location.reload(); });
            document.body.appendChild(bar);
          } catch (e) {}
        }
        // 主动向当前控制的 SW 询问版本：page 与 SW 版本不一致 = 有新版本未生效（兜住一切错过时机的情况）
        function askVersion() {
          if (!navigator.serviceWorker.controller) return;
          try { navigator.serviceWorker.controller.postMessage({ type: "GET_VERSION" }); } catch (e) {}
        }
        navigator.serviceWorker.addEventListener("message", function (e) {
          if (e.data && e.data.type === "VERSION" && pageVer && e.data.version !== "shenlun-app-v" + pageVer) showUpdateBar();
        });
        // 新 SW 接管（claim）时重新握手；首次无 controller 时不触发
        navigator.serviceWorker.addEventListener("controllerchange", function () {
          if (navigator.serviceWorker.controller) setTimeout(askVersion, 300);
        });
        if (reg.waiting) showUpdateBar();
        reg.addEventListener("updatefound", function () {
          var w = reg.installing;
          if (!w) return;
          w.addEventListener("statechange", function () {
            if (w.state === "installed") showUpdateBar();
          });
        });
        askVersion();
        try { reg.update(); } catch (e) {} // 立即强制检查更新，不等浏览器节流的周期检查
      });
    } catch (e) {}
  }

  // ---------- 数据备份：导出/导入 JSON（纯本地数据，换机前先导出） ----------
  $("btn-export").addEventListener("click", function () {
    try {
      var data = JSON.stringify(store);
      if (typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
        toast("备份已生成（" + data.length + " 字节）");
        return;
      }
      var blob = new Blob([data], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "shenlun-backup-" + todayStr + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
      toast("备份文件已导出，请妥善保存");
    } catch (e) {
      toast("导出失败：" + (e && e.message));
    }
  });
  $("btn-import").addEventListener("click", function () { $("import-file").click(); });
  $("import-file").addEventListener("change", function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var input = this;
    var reader = new FileReader();
    reader.onerror = function () { toast("读取备份失败，请重新选择文件"); input.value = ""; };
    reader.onload = function () {
      try {
        var d = JSON.parse(reader.result);
        if (!d || typeof d !== "object" || !d.days || !d.stats) throw new Error("这不是本应用的备份文件");
        if (!confirm("导入将覆盖当前全部学习记录（重学本/成绩/打卡），确定继续吗？")) { input.value = ""; return; }
        var base = defaultStore();
        Object.keys(base).forEach(function (k) {
          if (d[k] !== undefined) base[k] = d[k];
        });
        store = base;
        if (store.today !== todayStr) { store.today = todayStr; store.todayCount = 0; }
        if (store.dailyDate !== todayStr) { store.dailyDate = todayStr; store.dailyDone = {}; }
        saveStore();
        goHome();
        toast("备份已导入，全部记录已恢复");
      } catch (e) {
        toast("导入失败：" + (e && e.message));
      }
      input.value = "";
    };
    reader.readAsText(f);
  });
  $("btn-sl-guide").addEventListener("click", function () {
    showView("slguide");
  });
  $("btn-methods").addEventListener("click", function () {
    showView("methods");
  });

  // 底部导航：页签直达（答题页中点导航＝先退出本轮，≥5 题需确认防误触）
  $("tab-home").addEventListener("click", function () {
    if (!views.quiz.hidden) { if (!confirmQuitIfNeeded()) return; quitQuiz(); return; }
    if (views.home.hidden) goHome();
  });
  $("tab-stats").addEventListener("click", function () {
    if (!views.quiz.hidden) { if (!confirmQuitIfNeeded()) return; quitQuiz(); }
    renderStats();
    showView("stats");
  });
  $("tab-wrong").addEventListener("click", function () {
    if (!views.quiz.hidden) { if (!confirmQuitIfNeeded()) return; quitQuiz(); }
    renderWrongBook();
    showView("wrong");
  });
  $("tab-fav").addEventListener("click", function () {
    if (!views.quiz.hidden) { if (!confirmQuitIfNeeded()) return; quitQuiz(); }
    renderFavBook();
    showView("fav");
  });
  $("tab-settings").addEventListener("click", function () {
    if (!views.quiz.hidden) { if (!confirmQuitIfNeeded()) return; quitQuiz(); }
    renderPrefs();
    showView("settings");
  });
  $("btn-clear-wrong").addEventListener("click", function () {
    if (Object.keys(store.wrong).length === 0) { toast("重学本已经是空的"); return; }
    if (confirm("确定清空重学本吗？清空后不可恢复哦")) {
      store.wrong = {};
      saveStore();
      renderWrongBook();
      updateHomeBadge();
      toast("已清空重学本");
    }
  });
  $("btn-confirm").addEventListener("click", function () { shenlunEval(true); });   // 答到了 ✓
  $("btn-miss").addEventListener("click", function () { shenlunEval(false); });      // 没答到 ✗
  $("btn-peek").addEventListener("click", shenlunPeek); // 写完了，对照参考答案
  $("btn-next").addEventListener("click", nextQuestion);
  $("btn-prev-q").addEventListener("click", prevQuestion);
  $("btn-next-q").addEventListener("click", browseNext);
  $("btn-fav").addEventListener("click", function () {
    var id = session.current && session.current.id;
    if (!id) return;
    if (store.favorites[id]) {
      delete store.favorites[id];
      toast("已取消收藏");
    } else {
      store.favorites[id] = 1;
      toast("已收藏，可在首页收藏本查看");
    }
    saveStore();
    var fav = !!store.favorites[id];
    this.textContent = fav ? "★" : "☆";
    this.classList.toggle("on", fav);
    this.setAttribute("aria-pressed", fav ? "true" : "false");
    this.setAttribute("aria-label", fav ? "取消收藏本题" : "收藏本题");
    updateHomeBadge();
  });
  $("note-input").addEventListener("blur", function () {
    saveCurrentNote();
    var tip = $("note-saved");
    if (session.current) {
      tip.hidden = false;
      clearTimeout(saveCurrentNote._t);
      saveCurrentNote._t = setTimeout(function () { tip.hidden = true; }, 1200);
    }
  });
  $("btn-toggle-material").addEventListener("click", function () {
    var body = $("material-body");
    var collapsed = body.classList.toggle("collapsed");
    this.textContent = collapsed ? "展开" : "收起";
    this.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });
  $("scope-guokao").addEventListener("click", function () { switchScope("guokao"); });
  $("scope-tianjin").addEventListener("click", function () { switchScope("tianjin"); });

  // 搜题入口 + 关键词防抖搜索 + 分享
  $("btn-open-search").addEventListener("click", openSearchView);
  $("search-input").addEventListener("input", function () {
    var v = this.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { searchQuestions(v); }, 250);
  });
  $("btn-share").addEventListener("click", doShare);

  // ---------- 搜题：关键词匹配题干+选项+来源，结果点击进单题会话 ----------
  var searchTimer = null;
  function openSearchView() {
    showView("search");
    var input = $("search-input");
    searchQuestions(input.value);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
  }
  function searchQuestions(kw) {
    kw = (kw || "").trim();
    var tip = $("search-tip");
    var box = $("search-results");
    if (!kw) {
      tip.hidden = false;
      tip.textContent = "输入题干、选项或年份关键词，找到题目后可直接作答与分享。";
      box.innerHTML = "";
      return;
    }
    var lower = kw.toLowerCase();
    var hits = [];
    for (var i = 0; i < ALL_QUESTIONS.length && hits.length < 60; i++) {
      var q = ALL_QUESTIONS[i];
      var hay = (q.question || "") + "\n" + (q.options || []).join("\n") + "\n" + (q.source || "");
      if (hay.toLowerCase().indexOf(lower) === -1) continue;
      hits.push(q);
    }
    box.innerHTML = "";
    tip.hidden = false;
    if (!hits.length) {
      tip.textContent = "没有找到含「" + kw + "」的题目，换个关键词试试";
      return;
    }
    tip.textContent = "找到 " + hits.length + " 道相关题目" + (hits.length >= 60 ? "（仅展示前 60 条，可换个更精确的关键词）" : "");
    hits.forEach(function (q) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "search-item";
      var stem = blankify(q.question || "").replace(/\s+/g, " ").trim();
      if (stem.length > 64) stem = stem.slice(0, 64) + "…";
      var meta = document.createElement("div");
      meta.className = "search-item-stem";
      meta.textContent = stem || "（图片题，点击查看）";
      var sub = document.createElement("div");
      sub.className = "search-item-meta";
      var scopeName = examOf(q) === "tianjin" ? "天津" : examOf(q) === "jilin" ? "吉林" : "国考";
      sub.textContent = scopeName + " · " + q.source;
      item.appendChild(meta);
      item.appendChild(sub);
      item.addEventListener("click", function () { startSingle(q, "search"); });
      box.appendChild(item);
    });
  }

  // ---------- 分享：?q=<id> 深链，微信里打开直达该题 ----------
  function shareUrlOf(q) {
    return location.origin + location.pathname + "?q=" + encodeURIComponent(q.id);
  }
  function legacyCopy(text, okMsg) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast(okMsg); }
    catch (e) { toast("复制失败，请手动复制地址栏链接"); }
    document.body.removeChild(ta);
  }
  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function () { legacyCopy(text, okMsg); });
    } else {
      legacyCopy(text, okMsg);
    }
  }
  function doShare() {
    var q = session.current;
    if (!q) return;
    var url = shareUrlOf(q);
    var text = "来挑战这道题：" + (q.question || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (navigator.share) {
      navigator.share({ title: "申论学习 · 分享题目", text: text, url: url }).catch(function () {});
    } else {
      copyText(url, "链接已复制，去微信粘贴给朋友吧");
    }
  }

  // ---------- 启动 ----------
  renderHome();

  // ?q=<id> 深链：好友分享的题目直达（找不到则提示）
  (function () {
    var m = /[?&]q=([^&]+)/.exec(location.search);
    if (!m) return;
    var id = m[1];
    try { id = decodeURIComponent(id); } catch (e) {}
    var q = null;
    for (var i = 0; i < ALL_QUESTIONS.length; i++) {
      if (ALL_QUESTIONS[i].id === id) { q = ALL_QUESTIONS[i]; break; }
    }
    if (q) { startSingle(q, "home"); toast("好友分享的题目，学完点「完成」返回"); }
    else toast("分享的题目不存在或已下线");
  })();

  // PWA 壳进度条钩子：全部题库 + app.js 执行到这里 = 题库就绪（源码版 window 上无此函数，静默跳过）
  if (typeof window.__bReady === "function") window.__bReady();
})();
