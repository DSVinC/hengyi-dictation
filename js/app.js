/**
 * 恒一听写系统 - 主逻辑
 *
 * 功能：
 * 1. 三级导航：科目 → 课/单元 → 词勾选
 * 2. 艾宾浩斯轮次计算
 * 3. 生成听写清单（新课词 + 复习词）
 */

// ============================================
// 应用状态
// ============================================
const AppState = {
  currentPage: 'dictation',  // 当前页面：dictation, vocabulary, progress
  currentSubject: null,       // 当前科目：chinese, english
  currentLesson: null,       // 当前课/单元
  selectedWords: new Set(),   // 已勾选的词语
  lessons: [],                // 语文课列表
  units: [],                  // 英语单元列表
  wordData: {}                // 缓存的词语数据
};

// ============================================
// 艾宾浩斯复习间隔（天）
// 第0轮: 新学 → 第1轮: 1天后 → 第2轮: 2天后
// 第3轮: 4天后 → 第4轮: 7天后 → 第5轮: 15天后
// ============================================
const EBINGHAUS_INTERVALS = [1, 2, 4, 7, 15];

/**
 * 计算下一次复习日期
 * @param {number} round - 当前轮次 (0-5)
 * @returns {string|null} 下次复习日期 (ISO 格式) 或 null
 */
function calculateNextReview(round) {
  if (round >= 5) return null; // 第5轮后视为完全掌握
  const days = EBINGHAUS_INTERVALS[round];
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate.toISOString().split('T')[0];
}

/**
 * 判断词语是否需要复习（已到期）
 * @param {object} word - 词语对象
 * @returns {boolean}
 */
function isWordDueForReview(word) {
  if (!word.nextReview || word.round === 0) return false;
  const today = new Date().toISOString().split('T')[0];
  return word.nextReview <= today;
}

// ============================================
// 数据加载
// ============================================

/**
 * 加载语文课列表
 */
async function loadChineseLessons() {
  try {
    const response = await fetch('data/chinese/lessons.json');
    const data = await response.json();
    AppState.lessons = data.lessons;
    return data.lessons;
  } catch (error) {
    console.error('加载语文课列表失败:', error);
    return [];
  }
}

/**
 * 加载英语单元列表
 */
async function loadEnglishUnits() {
  try {
    const response = await fetch('data/english/units.json');
    const data = await response.json();
    AppState.units = data.units;
    return data.units;
  } catch (error) {
    console.error('加载英语单元列表失败:', error);
    return [];
  }
}

/**
 * 加载课/单元的词语数据
 * @param {string} subject - 科目 (chinese/english)
 * @param {string} lessonId - 课/单元ID
 */
async function loadWordData(subject, lessonId) {
  const cacheKey = `${subject}/${lessonId}`;
  if (AppState.wordData[cacheKey]) {
    return AppState.wordData[cacheKey];
  }

  try {
    const path = subject === 'chinese'
      ? `data/chinese/${lessonId}.json`
      : `data/english/${lessonId}.json`;
    const response = await fetch(path);
    const data = await response.json();
    AppState.wordData[cacheKey] = data;
    return data;
  } catch (error) {
    console.error(`加载词语数据失败 [${lessonId}]:`, error);
    return null;
  }
}

// ============================================
// 页面渲染
// ============================================

/**
 * 渲染主内容区
 */
function renderContent(html) {
  document.getElementById('main-content').innerHTML = html;
}

/**
 * 渲染听写模式页面
 */
async function renderDictationPage() {
  const html = `
    <h2 class="page-title">选择科目</h2>
    <div class="subject-select">
      <button class="subject-btn chinese" onclick="selectSubject('chinese')">
        <span class="subject-icon">📖</span>
        <span>语文</span>
      </button>
      <button class="subject-btn english" onclick="selectSubject('english')">
        <span class="subject-icon">📚</span>
        <span>英语</span>
      </button>
    </div>
  `;
  renderContent(html);
}

/**
 * 选择科目后渲染课/单元列表
 */
async function selectSubject(subject) {
  AppState.currentSubject = subject;
  AppState.selectedWords.clear();

  const isChinese = subject === 'chinese';
  const items = isChinese
    ? await loadChineseLessons()
    : await loadEnglishUnits();

  const subjectName = isChinese ? '语文' : '英语';
  const itemName = isChinese ? '课' : '单元';

  if (items.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="goBack()">← 返回</button>
      <div class="empty-state">
        <p class="empty-icon">📭</p>
        <p class="empty-text">暂无${itemName}数据</p>
      </div>
    `);
    return;
  }

  const listHtml = items.map(item => `
    <div class="lesson-item" onclick="selectLesson('${item.id}')">
      <span class="lesson-name">${item.name}</span>
      <span class="lesson-arrow">›</span>
    </div>
  `).join('');

  renderContent(`
    <button class="back-btn" onclick="goBack()">← 返回</button>
    <h2 class="page-title">${subjectName}${itemName}列表</h2>
    <div class="lesson-list">${listHtml}</div>
  `);
}

/**
 * 选择课/单元后渲染词语勾选列表
 */
async function selectLesson(lessonId) {
  AppState.currentLesson = lessonId;
  AppState.selectedWords.clear();

  const subject = AppState.currentSubject;
  const data = await loadWordData(subject, lessonId);

  if (!data || !data.words || data.words.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="goBackToLessons()">← 返回</button>
      <div class="empty-state">
        <p class="empty-icon">📭</p>
        <p class="empty-text">暂无词语数据</p>
      </div>
    `);
    return;
  }

  const isChinese = subject === 'chinese';
  const title = isChinese ? data.lessonName : data.unitName;

  renderWordSelectionPage(data, title, isChinese);
}

/**
 * 渲染词语勾选页面
 */
function renderWordSelectionPage(data, title, isChinese) {
  const wordsHtml = data.words.map(word => {
    const isDue = isWordDueForReview(word);
    const reviewTag = isDue
      ? `<span class="review-tag round-${word.round}">R${word.round}</span>`
      : '';

    const meaningHtml = !isChinese && word.meaning
      ? `<span class="word-meaning">${word.meaning}</span>`
      : '';

    const typeHtml = isChinese && word.type
      ? `<span class="word-type">${word.type === 'char' ? '字' : '词'}</span>`
      : '';

    return `
      <label class="word-item" data-word="${word.text}">
        <input type="checkbox" class="word-checkbox"
          onchange="toggleWordSelection('${word.text}')"
          ${word.round > 0 && isDue ? 'checked' : ''}>
        <span class="word-text">${word.text}${reviewTag}</span>
        ${typeHtml}
        ${meaningHtml}
      </label>
    `;
  }).join('');

  renderContent(`
    <button class="back-btn" onclick="goBackToLessons()">← 返回</button>
    <h2 class="page-title">${title}</h2>
    <div class="word-list">${wordsHtml}</div>
    <div class="action-bar">
      <button class="btn btn-secondary" onclick="selectAllWords()">全选</button>
      <button class="btn btn-primary" onclick="generateDictationList()">生成听写清单</button>
    </div>
    <div id="dictation-result"></div>
  `);

  // 自动选中所有到期复习的词
  data.words.forEach(word => {
    if (isWordDueForReview(word)) {
      AppState.selectedWords.add(word.text);
    }
  });
}

/**
 * 切换词语勾选状态
 */
function toggleWordSelection(wordText) {
  if (AppState.selectedWords.has(wordText)) {
    AppState.selectedWords.delete(wordText);
  } else {
    AppState.selectedWords.add(wordText);
  }
}

/**
 * 全选当前课/单元的所有词语
 */
function selectAllWords() {
  const subject = AppState.currentSubject;
  const lessonId = AppState.currentLesson;
  const cacheKey = `${subject}/${lessonId}`;
  const data = AppState.wordData[cacheKey];

  if (data && data.words) {
    data.words.forEach(word => {
      AppState.selectedWords.add(word.text);
    });

    // 更新 UI
    document.querySelectorAll('.word-checkbox').forEach(cb => {
      cb.checked = true;
    });
  }
}

/**
 * 生成听写清单
 */
function generateDictationList() {
  if (AppState.selectedWords.size === 0) {
    alert('请先勾选词语');
    return;
  }

  const subject = AppState.currentSubject;
  const lessonId = AppState.currentLesson;
  const cacheKey = `${subject}/${lessonId}`;
  const data = AppState.wordData[cacheKey];
  const isChinese = subject === 'chinese';

  // 分类：新课词 vs 复习词
  const newWords = [];
  const reviewWords = [];

  data.words.forEach(word => {
    if (AppState.selectedWords.has(word.text)) {
      if (word.round === 0) {
        newWords.push(word);
      } else {
        reviewWords.push(word);
      }
    }
  });

  // 构建清单 HTML
  let resultHtml = '<div class="dictation-list">';

  if (newWords.length > 0) {
    resultHtml += `
      <div class="dictation-section">
        <h3 class="section-title new">📝 新课词语 (${newWords.length})</h3>
        <div class="dictation-words">
          ${newWords.map(w => `<span class="dictation-word new">${w.text}</span>`).join('')}
        </div>
      </div>
    `;
  }

  if (reviewWords.length > 0) {
    resultHtml += `
      <div class="dictation-section">
        <h3 class="section-title review">🔄 复习词语 (${reviewWords.length})</h3>
        <div class="dictation-words">
          ${reviewWords.map(w => {
            const roundTag = w.round >= 5 ? '✅' : `R${w.round}`;
            return `<span class="dictation-word review">${w.text} <small>${roundTag}</small></span>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  resultHtml += '</div>';

  // 统计信息
  const total = newWords.length + reviewWords.length;
  resultHtml += `<p style="text-align:center; margin-top:16px; color:#666;">共 ${total} 个词语</p>`;

  document.getElementById('dictation-result').innerHTML = resultHtml;
}

/**
 * 返回上一级
 */
function goBack() {
  AppState.currentSubject = null;
  AppState.selectedWords.clear();
  renderDictationPage();
}

/**
 * 返回课/单元列表
 */
function goBackToLessons() {
  AppState.currentLesson = null;
  AppState.selectedWords.clear();
  selectSubject(AppState.currentSubject);
}

// ============================================
// 导航
// ============================================

/**
 * 获取词语状态文本
 * @param {number} round - 当前轮次
 * @returns {object} {icon, text, className}
 */
function getWordStatus(round) {
  if (round === 0) {
    return { icon: '🆕', text: '新词', className: 'status-new' };
  } else if (round >= 1 && round <= 5) {
    return { icon: '📝', text: `复习中 R${round}`, className: 'status-review' };
  } else {
    return { icon: '✅', text: '已掌握', className: 'status-mastered' };
  }
}

/**
 * 格式化日期显示
 * @param {string|null} dateStr - ISO日期字符串
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dateOnly = date.toDateString();
  if (dateOnly === today.toDateString()) return '今天';
  if (dateOnly === tomorrow.toDateString()) return '明天';

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}月${day}日`;
}

// ============================================
// 词库管理页面
// ============================================

/**
 * 渲染词库管理页面 - 科目选择
 */
function renderVocabularyPage() {
  AppState.currentSubject = null;
  AppState.currentLesson = null;

  const html = `
    <h2 class="page-title">词库管理</h2>
    <div class="subject-select">
      <button class="subject-btn chinese" onclick="selectVocabSubject('chinese')">
        <span class="subject-icon">📖</span>
        <span>语文</span>
      </button>
      <button class="subject-btn english" onclick="selectVocabSubject('english')">
        <span class="subject-icon">📚</span>
        <span>英语</span>
      </button>
    </div>
  `;
  renderContent(html);
}

/**
 * 选择科目后渲染课/单元列表（词库管理）
 */
async function selectVocabSubject(subject) {
  AppState.currentSubject = subject;

  const isChinese = subject === 'chinese';
  const items = isChinese
    ? await loadChineseLessons()
    : await loadEnglishUnits();

  const subjectName = isChinese ? '语文' : '英语';
  const itemName = isChinese ? '课' : '单元';

  if (items.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="renderVocabularyPage()">← 返回</button>
      <div class="empty-state">
        <p class="empty-icon">📭</p>
        <p class="empty-text">暂无${itemName}数据</p>
      </div>
    `);
    return;
  }

  // 统计每个课/单元的词语状态
  const itemsWithStats = await Promise.all(items.map(async (item) => {
    const data = await loadWordData(subject, item.id);
    if (!data || !data.words) {
      return { ...item, newCount: 0, reviewCount: 0, masteredCount: 0, totalCount: 0 };
    }
    const newCount = data.words.filter(w => w.round === 0).length;
    const reviewCount = data.words.filter(w => w.round >= 1 && w.round <= 5).length;
    const masteredCount = data.words.filter(w => w.round >= 6).length;
    return { ...item, newCount, reviewCount, masteredCount, totalCount: data.words.length };
  }));

  const listHtml = itemsWithStats.map(item => `
    <div class="lesson-item" onclick="selectVocabLesson('${item.id}')">
      <div class="lesson-info">
        <span class="lesson-name">${item.name}</span>
        <div class="lesson-stats">
          <span class="stat-badge stat-new">🆕 ${item.newCount}</span>
          <span class="stat-badge stat-review">📝 ${item.reviewCount}</span>
          <span class="stat-badge stat-mastered">✅ ${item.masteredCount}</span>
        </div>
      </div>
      <span class="lesson-arrow">›</span>
    </div>
  `).join('');

  renderContent(`
    <button class="back-btn" onclick="renderVocabularyPage()">← 返回</button>
    <h2 class="page-title">${subjectName}${itemName}列表</h2>
    <div class="lesson-list">${listHtml}</div>
  `);
}

/**
 * 选择课/单元后渲染词语列表（词库管理）
 */
async function selectVocabLesson(lessonId) {
  AppState.currentLesson = lessonId;

  const subject = AppState.currentSubject;
  const data = await loadWordData(subject, lessonId);
  const isChinese = subject === 'chinese';

  if (!data || !data.words || data.words.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="selectVocabSubject('${subject}')">← 返回</button>
      <div class="empty-state">
        <p class="empty-icon">📭</p>
        <p class="empty-text">暂无词语数据</p>
      </div>
    `);
    return;
  }

  const title = isChinese ? data.lessonName : data.unitName;

  // 按状态分组排序：新词 → 复习中 → 已掌握
  const sortedWords = [...data.words].sort((a, b) => {
    const getPriority = (w) => {
      if (w.round === 0) return 0;
      if (w.round >= 1 && w.round <= 5) return 1;
      return 2;
    };
    return getPriority(a) - getPriority(b);
  });

  const wordsHtml = sortedWords.map(word => {
    const status = getWordStatus(word.round);
    const meaningHtml = !isChinese && word.meaning
      ? `<span class="vocab-word-meaning">${word.meaning}</span>`
      : '';

    const typeHtml = isChinese && word.type
      ? `<span class="word-type">${word.type === 'char' ? '字' : '词'}</span>`
      : '';

    const nextReviewText = word.nextReview ? formatDate(word.nextReview) : '-';

    return `
      <div class="vocab-word-item">
        <div class="vocab-word-main">
          <span class="vocab-word-text">${word.text}</span>
          ${typeHtml}
          ${meaningHtml}
        </div>
        <div class="vocab-word-meta">
          <span class="vocab-status ${status.className}">${status.icon} ${status.text}</span>
          <span class="vocab-next-review">下次: ${nextReviewText}</span>
        </div>
      </div>
    `;
  }).join('');

  // 统计信息
  const newCount = data.words.filter(w => w.round === 0).length;
  const reviewCount = data.words.filter(w => w.round >= 1 && w.round <= 5).length;
  const masteredCount = data.words.filter(w => w.round >= 6).length;

  renderContent(`
    <button class="back-btn" onclick="selectVocabSubject('${subject}')">← 返回</button>
    <h2 class="page-title">${title}</h2>
    <div class="vocab-summary">
      <span class="stat-badge stat-new">🆕 新词 ${newCount}</span>
      <span class="stat-badge stat-review">📝 复习 ${reviewCount}</span>
      <span class="stat-badge stat-mastered">✅ 掌握 ${masteredCount}</span>
    </div>
    <div class="vocab-word-list">${wordsHtml}</div>
  `);
}

/**
 * 切换页面
 */
function switchPage(page) {
  AppState.currentPage = page;

  // 更新导航栏状态
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  // 重置状态
  AppState.currentSubject = null;
  AppState.currentLesson = null;
  AppState.selectedWords.clear();

  // 渲染对应页面
  switch (page) {
    case 'dictation':
      renderDictationPage();
      break;
    case 'vocabulary':
      renderVocabularyPage();
      break;
    case 'progress':
      renderContent(`
        <div class="empty-state">
          <p class="empty-icon">📊</p>
          <h2 class="page-title">进度总览</h2>
          <p class="empty-text">功能开发中...</p>
        </div>
      `);
      break;
  }
}

// ============================================
// 初始化
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  // 绑定导航按钮事件
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  // 默认显示听写模式
  renderDictationPage();
});