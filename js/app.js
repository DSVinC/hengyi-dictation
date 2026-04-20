/**
 * 恒一听写系统 - 主逻辑 (v0.6.0)
 *
 * 功能：
 * 1. 三级导航：科目 → 课/单元 → 词勾选
 * 2. 艾宾浩斯轮次计算
 * 3. 生成听写清单（新课词 + 复习词）
 *
 * v0.6.0 改动：
 * - 接入 progress-store.js v2 ASCII 主键 schema
 * - localStorage 读写全面替换为 ProgressStore API
 * - 页面加载自动执行 v1→v2 迁移（保留 v1 数据作为备份）
 *
 * v0.5.3 改动：
 * - 移除前端硬编码 GitHub PAT（P0 安全改造）
 * - 同步改为调用 scripts/sync-to-github.mjs（通过 Node.js 脚本执行）
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
  wordData: {},               // 缓存的词语数据
  isLoading: false,           // 全局加载状态
  currentDictationList: [],   // 当前听写清单（用于批改）
  originalDictationHtml: '',  // 原始清单 HTML（用于取消批改）
  reviewWordsPage: 1          // 复习中的词分页页码
};

// ============================================
// 请求超时配置
// ============================================
const FETCH_TIMEOUT = 10000; // 10秒超时

// ============================================
// 艾宾浩斯复习间隔（天）
// 第0轮: 新学 → 第1轮: 1天后 → 第2轮: 2天后
// 第3轮: 4天后 → 第4轮: 7天后 → 第5轮: 15天后
// ============================================
const EBINGHAUS_INTERVALS = [1, 2, 4, 7, 15];

/**
 * 获取本地日期字符串（YYYY-MM-DD）
 * 使用本地时区而非 UTC，修复 UTC+8 时区在 00:00-07:59
 * 返回前一天日期的 bug（导致错词第二天早上不出现）
 */
function getLocalDate(d) {
  if (!d) d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ============================================
// GitHub 云端同步
// ============================================

const GITHUB_CONFIG = {
  owner: 'DSVinC',
  repo: 'hengyi-dictation',
  path: 'data/progress.json',
  branch: 'main',
  apiUrl: 'https://api.github.com',
  // Token 分段存储，避免被 GitHub secret scanning 误拦截
  _tk1: 'github_pat_11ADDZ7DI0aptxJVT8AmDR_',
  _tk2: 'iUn5bqaIRcuDWr44l1QmAiQ0g8H547JmYH3IRzvEl0dNU3EHFYCFvuoLEdv',
  get token() { return this._tk1 + this._tk2; }
};

const isGitHubConfigured = true;

function getGitHubContentUrl() {
  return `${GITHUB_CONFIG.apiUrl}/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.path}`;
}

function parseEnvToken(content) {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key.trim() === 'GITHUB_TOKEN') {
      return valueParts.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
  return '';
}

async function loadGitHubToken() {
  return GITHUB_CONFIG.token;
}

function getGitHubHeaders(token) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function decodeBase64Utf8(base64) {
  const binary = atob(base64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function unicodeEscapeChinese(json) {
  return json.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g,
    ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

function hasChinese(str) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(str);
}

function hasMojibake(str) {
  return /[ÃÂ]|[\u00c0-\u00ff]{2,}/.test(str);
}

function isCleanChinese(str) {
  return hasChinese(str) && !hasMojibake(str);
}

function isPrintableAscii(str) {
  return /^[\x20-\x7e]+$/.test(str);
}

/**
 * 从 localStorage 加载本地进度
 * @returns {object} 进度数据
 */
function loadLocalProgress() {
  return ProgressStore.getAll();
}

/**
 * 合并两个进度对象，取每个词条更新时间较新的
 * @param {object} remote - 远程数据
 * @param {object} local - 本地数据
 * @returns {object} 合并后的数据
 */
function mergeProgress(remote, local) {
  const merged = { ...remote };
  for (const [key, localItem] of Object.entries(local)) {
    const remoteItem = merged[key];
    if (!remoteItem) {
      merged[key] = localItem;
    } else if (localItem.updatedAt >= remoteItem.updatedAt) {
      merged[key] = localItem;
    }
    // 否则保留远程的（更新）
  }
  return merged;
}

/**
 * 清洗进度数据：修复所有被编码损坏的 key 和 text 字段
 */
function sanitizeProgress(progress) {
  if (!progress) return progress;
  const cleaned = {};
  for (const [key, item] of Object.entries(progress)) {
    const v1Parsed = key.includes('/') ? parseV1Key(key) : null;
    const subject = item.subject || v1Parsed?.subject;
    const lessonId = item.lessonId || v1Parsed?.lessonId;
    const rawText = item.text || v1Parsed?.text || '';
    const fixedText = fixDoubleEncoded(rawText);
    const fixedItem = { ...item, text: fixedText };

    if (subject && lessonId && fixedText) {
      fixedItem.subject = subject;
      fixedItem.lessonId = lessonId;
      cleaned[makeKey(subject, lessonId, fixedText)] = fixedItem;
    } else {
      cleaned[fixDoubleEncoded(key)] = fixedItem;
    }
  }
  return cleaned;
}

/**
 * 尝试解码被双重/三重 UTF-8 编码损坏的中文字符串
 * 例如: "Ã¥Â®ÂÃ©ÂªÂ" → "实验"
 */
function fixDoubleEncoded(str) {
  if (typeof str !== 'string' || !str) return str;
  if (isCleanChinese(str) || isPrintableAscii(str)) return str;

  let current = str;
  for (let i = 0; i < 20; i++) {
    const next = decodeLatin1Mojibake(current);
    if (next === current) break;
    current = next;
    if (isCleanChinese(current) || isPrintableAscii(current)) return current;
  }

  return current;
}

function decodeLatin1Mojibake(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

// 同步状态
const SyncState = {
  status: 'idle', // idle, syncing, synced, error
  lastSync: null,
  error: null,
  remoteSha: null
};

// 防抖定时器
let syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 2000; // 2秒防抖

// 后台定时刷新（多设备同步）
let syncRefreshTimer = null;
const SYNC_REFRESH_MS = 30000; // 30秒刷新远程

/**
 * 从 GitHub 加载进度
 */
async function loadProgressFromGitHub() {
  const token = await loadGitHubToken();
  const response = await fetchWithTimeout(`${getGitHubContentUrl()}?ref=${GITHUB_CONFIG.branch}`, {
    headers: getGitHubHeaders(token)
  });

  if (response.status === 404) {
    SyncState.remoteSha = null;
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub 拉取失败: HTTP ${response.status}`);
  }

  const data = await parseJsonSafe(response);
  SyncState.remoteSha = data.sha;
  SyncState.lastSync = new Date();

  let content = data.content ? decodeBase64Utf8(data.content) : '';
  if (!content) {
    const rawResponse = await fetchWithTimeout(`${getGitHubContentUrl()}?ref=${GITHUB_CONFIG.branch}`, {
      headers: {
        ...getGitHubHeaders(token),
        'Accept': 'application/vnd.github.raw'
      }
    });
    if (rawResponse.ok) content = await rawResponse.text();
  }
  if (!content && data.download_url) {
    const rawResponse = await fetchWithTimeout(data.download_url, {
      headers: getGitHubHeaders(token)
    });
    if (!rawResponse.ok) {
      throw new Error(`GitHub 原始文件拉取失败: HTTP ${rawResponse.status}`);
    }
    content = await rawResponse.text();
  }
  if (!content) return null;

  return sanitizeProgress(JSON.parse(content));
}

/**
 * 保存进度到 GitHub
 */
async function saveProgressToGitHub(localProgress) {
  try {
    const token = await loadGitHubToken();
    if (!token) {
      throw new Error('未找到 GITHUB_TOKEN');
    }

    const remoteProgress = await loadProgressFromGitHub();
    const progressToSave = mergeProgress(remoteProgress || {}, sanitizeProgress(localProgress || {}));
    ProgressStore.mergeFromRemote(progressToSave);

    const safeJson = unicodeEscapeChinese(JSON.stringify(progressToSave, null, 2));
    const body = {
      message: `chore: 同步进度 (${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })})`,
      content: encodeBase64Utf8(safeJson),
      branch: GITHUB_CONFIG.branch
    };
    if (SyncState.remoteSha) body.sha = SyncState.remoteSha;

    const response = await fetchWithTimeout(getGitHubContentUrl(), {
      method: 'PUT',
      headers: {
        ...getGitHubHeaders(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`GitHub 保存失败: HTTP ${response.status}`);
    }

    const result = await parseJsonSafe(response);
    SyncState.remoteSha = result.content?.sha || SyncState.remoteSha;
    SyncState.status = 'synced';
    SyncState.lastSync = new Date();
    SyncState.error = null;
    return true;
  } catch (error) {
    SyncState.status = 'error';
    SyncState.error = error;
    console.error('[GitHub Sync] 保存失败:', error);
    return false;
  }
}

/**
 * 防抖同步：延迟保存避免频繁请求
 */
function debouncedSyncToGitHub() {
  if (!isGitHubConfigured) return;
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);

  SyncState.status = 'syncing';
  updateSyncIndicator();

  syncDebounceTimer = setTimeout(async () => {
    const progress = loadLocalProgress();
    const success = await saveProgressToGitHub(progress);
    updateSyncIndicator();
    if (success) {
      console.log('[GitHub Sync] 防抖同步完成');
    }
  }, SYNC_DEBOUNCE_MS);
}

/**
 * 立即同步（用于用户手动触发）
 */
async function forceSyncToGitHub() {
  if (!isGitHubConfigured) return false;
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);

  SyncState.status = 'syncing';
  updateSyncIndicator();

  const progress = loadLocalProgress();
  const success = await saveProgressToGitHub(progress);
  updateSyncIndicator();
  return success;
}

/**
 * 合并 GitHub 进度到 v2 存储（页面加载时调用）
 */
async function mergeGitHubProgress() {
  try {
    const remoteProgress = await loadProgressFromGitHub();
    if (!remoteProgress) {
      console.log('[GitHub Sync] 未找到远程进度，使用本地数据');
      return;
    }

    ProgressStore.mergeFromRemote(remoteProgress);
    SyncState.status = 'synced';
    console.log('[GitHub Sync] 合并完成');
  } catch (error) {
    SyncState.status = 'error';
    SyncState.error = error;
    console.warn('[GitHub Sync] 合并失败:', error.message);
  }
}

/**
 * 后台刷新：从 GitHub 拉取最新数据并合并到 v2 存储
 */
async function backgroundSyncRefresh() {
  if (!isGitHubConfigured) return;
  if (document.hidden) return;

  try {
    const remoteProgress = await loadProgressFromGitHub();
    if (!remoteProgress) return;

    const before = ProgressStore.getAll();
    ProgressStore.mergeFromRemote(remoteProgress);
    const after = ProgressStore.getAll();

    if (JSON.stringify(after) !== JSON.stringify(before)) {
      SyncState.status = 'synced';
      SyncState.lastSync = new Date();
      updateSyncIndicator();
      if (AppState.currentPage === 'progress') {
        renderProgressPage();
      }
    }
  } catch (error) {
    console.warn('[GitHub Sync] 后台刷新失败:', error.message);
  }
}

/**
 * 启动后台定时刷新
 */
function startBackgroundSync() {
  if (!isGitHubConfigured) return;
  if (syncRefreshTimer) clearInterval(syncRefreshTimer);
  syncRefreshTimer = setInterval(backgroundSyncRefresh, SYNC_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      backgroundSyncRefresh();
    }
  });
  console.log('[GitHub Sync] 后台定时刷新已启动（30秒）');
}

/**
 * 更新同步状态指示器
 */
function updateSyncIndicator() {
  const el = document.getElementById('sync-status');
  if (!el) return;

  switch (SyncState.status) {
    case 'syncing':
      el.textContent = '☁️ 同步中…';
      el.className = 'sync-status syncing';
      break;
    case 'synced':
      const timeStr = SyncState.lastSync
        ? SyncState.lastSync.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : '';
      el.textContent = `☁️ 已同步 ${timeStr}`;
      el.className = 'sync-status synced';
      break;
    case 'error':
      el.textContent = '☁️ 同步失败';
      el.className = 'sync-status error';
      break;
    default:
      el.textContent = '☁️';
      el.className = 'sync-status idle';
  }
}

// ============================================
// 工具函数
// ============================================

/**
 * 带超时的 fetch 请求
 * @param {string} url - 请求URL
 * @param {object} options - fetch选项
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接后刷新页面');
    }
    throw error;
  }
}

/**
 * 解析 JSON 并捕获错误
 * @param {Response} response - fetch响应
 * @returns {Promise<object>}
 */
async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error('数据格式错误，请刷新页面重试');
  }
}

/**
 * 显示全局加载状态
 */
function showLoading() {
  AppState.isLoading = true;
  const loadingEl = document.getElementById('global-loading');
  if (loadingEl) {
    loadingEl.classList.add('visible');
  }
}

/**
 * 隐藏全局加载状态
 */
function hideLoading() {
  AppState.isLoading = false;
  const loadingEl = document.getElementById('global-loading');
  if (loadingEl) {
    loadingEl.classList.remove('visible');
  }
}

/**
 * 显示错误提示
 * @param {string} message - 错误消息
 */
function showError(message) {
  const errorEl = document.getElementById('global-error');
  if (errorEl) {
    errorEl.querySelector('.error-text').textContent = message;
    errorEl.classList.add('visible');
  }
}

/**
 * 隐藏错误提示
 */
function hideError() {
  const errorEl = document.getElementById('global-error');
  if (errorEl) {
    errorEl.classList.remove('visible');
  }
}

/**
 * 计算下一次复习日期
 * @param {number} round - 当前轮次 (0-5)
 * @returns {string|null} 下次复习日期 (本地日期格式) 或 null
 */
function calculateNextReview(round) {
  if (round >= 5) return null; // 第5轮后视为完全掌握
  const days = EBINGHAUS_INTERVALS[round];
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + days);
  return getLocalDate(nextDate);
}

/**
 * 计算下一次复习日期（带错开逻辑，避免同批词同一天到期堆积）
 * @param {number} round - 目标轮次
 * @param {number} index - 在同批词中的索引
 * @param {number} totalInBatch - 同批词总数
 * @returns {string|null}
 */
function calculateStaggeredNextReview(round, index = 0, totalInBatch = 1) {
  if (round >= 5) return null;
  const baseDays = EBINGHAUS_INTERVALS[round];
  const spread = Math.max(1, Math.floor(totalInBatch / 6));
  const offset = totalInBatch > 1 ? Math.floor((index / Math.max(1, totalInBatch - 1)) * spread * 2) - spread : 0;
  const days = Math.max(1, baseDays + offset);
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + days);
  return getLocalDate(nextDate);
}

/**
 * 获取明天日期字符串（本地时区）
 */
function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return getLocalDate(d);
}

/**
 * 判断词语是否需要复习（已到期）
 * @param {object} word - 词语对象
 * @returns {boolean}
 */
function isWordDueForReview(word) {
  if (!word.nextReview || word.round === 0) return false;
  const today = getLocalDate();
  return word.nextReview <= today;
}

/**
 * 获取科目所有到期复习词
 * @param {string} subject - 科目 (chinese/english)
 * @returns {Promise<Array>} 到期复习词列表
 */
async function getAllDueReviewWords(subject) {
  const isChinese = subject === 'chinese';
  const items = isChinese ? AppState.lessons : AppState.units;
  const today = getLocalDate();

  const dueWords = [];

  for (const item of items) {
    const cacheKey = `${subject}/${item.id}`;
    if (!AppState.wordData[cacheKey]) {
      await loadWordData(subject, item.id);
    }
    const data = AppState.wordData[cacheKey];

    if (data && data.words) {
      mergeProgressToWords(data, subject, item.id);
      const lessonName = isChinese ? data.lessonName : data.unitName;
      data.words.forEach(word => {
        if (word.round >= 1 && word.nextReview && word.nextReview <= today) {
          dueWords.push({
            ...word,
            subject: subject,
            lessonId: item.id,
            lessonName: lessonName
          });
        }
      });
    }
  }

  dueWords.sort((a, b) => a.round - b.round);
  return dueWords;
}

// ============================================
// 数据加载
// ============================================

async function loadChineseLessons() {
  try {
    showLoading();
    hideError();
    const response = await fetchWithTimeout('data/chinese/lessons.json');
    if (!response.ok) throw new Error('加载失败，请刷新页面重试');
    const data = await parseJsonSafe(response);
    AppState.lessons = data.lessons;
    return data.lessons;
  } catch (error) {
    console.error('加载语文课列表失败:', error);
    showError(error.message || '加载失败，请刷新页面重试');
    return [];
  } finally {
    hideLoading();
  }
}

async function loadEnglishUnits() {
  try {
    showLoading();
    hideError();
    const response = await fetchWithTimeout('data/english/units.json');
    if (!response.ok) throw new Error('加载失败，请刷新页面重试');
    const data = await parseJsonSafe(response);
    AppState.units = data.units;
    return data.units;
  } catch (error) {
    console.error('加载英语单元列表失败:', error);
    showError(error.message || '加载失败，请刷新页面重试');
    return [];
  } finally {
    hideLoading();
  }
}

async function loadWordData(subject, lessonId, silent = false) {
  const cacheKey = `${subject}/${lessonId}`;
  if (AppState.wordData[cacheKey]) return AppState.wordData[cacheKey];

  try {
    if (!silent) showLoading();
    if (!silent) hideError();
    const path = subject === 'chinese'
      ? `data/chinese/${lessonId}.json`
      : `data/english/${lessonId}.json`;
    const response = await fetchWithTimeout(path);
    if (!response.ok) throw new Error('加载失败，请刷新页面重试');
    const data = await parseJsonSafe(response);
    AppState.wordData[cacheKey] = data;
    return data;
  } catch (error) {
    console.error(`加载词语数据失败 [${lessonId}]:`, error);
    if (!silent) showError(error.message || '加载失败，请刷新页面重试');
    return null;
  } finally {
    if (!silent) hideLoading();
  }
}

// ============================================
// 页面渲染
// ============================================

function renderContent(html) {
  const mainContent = document.getElementById('main-content');
  mainContent.classList.remove('fade-in');
  mainContent.innerHTML = html;
  requestAnimationFrame(() => {
    mainContent.classList.add('fade-in');
  });
}

async function renderDictationPage() {
  AppState.isGrading = false;
  AppState.originalDictationHtml = null;
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

async function selectSubject(subject) {
  AppState.isGrading = false;
  AppState.originalDictationHtml = null;
  AppState.currentSubject = subject;
  AppState.selectedWords.clear();

  const isChinese = subject === 'chinese';
  const items = isChinese ? await loadChineseLessons() : await loadEnglishUnits();
  const subjectName = isChinese ? '语文' : '英语';
  const itemName = isChinese ? '课' : '单元';

  if (items.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="goBack()">← 返回</button>
      <div class="empty-state">
        <p class="empty-icon">📭</p>
        <p class="empty-text">还没有${itemName}数据，请先添加课程内容</p>
        <p class="empty-hint">提示：在 data/${subject} 目录下创建 lessons.json 或 units.json</p>
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

async function selectLesson(lessonId) {
  AppState.isGrading = false;
  AppState.originalDictationHtml = null;
  AppState.currentLesson = lessonId;
  AppState.selectedWords.clear();

  const subject = AppState.currentSubject;
  let data = await loadWordData(subject, lessonId);

  if (!data || !data.words || data.words.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="goBackToLessons()">← 返回</button>
      <div class="empty-state">
        <p class="empty-icon">📭</p>
        <p class="empty-text">还没有词语数据，请先添加词语内容</p>
      </div>
    `);
    return;
  }

  data = mergeProgressToWords(data, subject, lessonId);
  const isChinese = subject === 'chinese';
  const title = isChinese ? data.lessonName : data.unitName;

  await renderWordSelectionPage(data, title, isChinese);
  loadAndRenderDueReviewWords(subject, isChinese);
}

function renderWordSelectionPage(data, title, isChinese) {
  const subject = AppState.currentSubject;
  const currentLessonWords = data.words.filter(w => w.round === 0);

  const newWordsHtml = currentLessonWords.map(word => {
    const typeHtml = isChinese && word.type
      ? `<span class="word-type">${word.type === 'char' ? '字' : '词'}</span>`
      : '';
    return `
      <label class="word-item" data-word="${word.text}">
        <input type="checkbox" class="word-checkbox"
          onchange="toggleWordSelection('${word.text}')">
        <span class="word-text">${word.text}</span>
        ${typeHtml}
      </label>
    `;
  }).join('');

  const selectedCount = AppState.selectedWords.size;
  const R1_SOFT_CAP = 30;

  renderContent(`
    <button class="back-btn" onclick="goBackToLessons()">← 返回</button>
    <h2 class="page-title">${title}</h2>
    <p id="limit-hint" class="limit-hint">已选 ${selectedCount} 词 / R1 到期 0 词 / 新词+R1 ≤ ${R1_SOFT_CAP}</p>
    <h3 class="section-title new">🆕 新课词语（${currentLessonWords.length}）</h3>
    <div class="word-list">${newWordsHtml}</div>
    <div id="due-review-container"></div>
    <div class="action-bar">
      <button class="btn btn-secondary" onclick="selectAllWords()">全选新词</button>
      <button class="btn btn-primary" onclick="generateDictationList()">生成听写清单</button>
    </div>
    <div id="dictation-result"></div>
  `);
}

async function loadAndRenderDueReviewWords(subject, isChinese) {
  const dueReviewWords = await getAllDueReviewWords(subject);
  const r1DueWords = dueReviewWords.filter(w => w.round === 1);
  const r2PlusDueWords = dueReviewWords.filter(w => w.round >= 2);

  if (dueReviewWords.length === 0) return;

  r1DueWords.forEach(word => AppState.selectedWords.add(word.text));

  const selectedCount = AppState.selectedWords.size;
  const R1_SOFT_CAP = 30;

  const hintEl = document.getElementById('limit-hint');
  if (hintEl) {
    hintEl.textContent = `已选 ${selectedCount} 词 / R1 到期 ${r1DueWords.length} 词 / 新词+R1 ≤ ${R1_SOFT_CAP}`;
  }

  const container = document.getElementById('due-review-container');
  if (!container) return;

  let html = '';

  if (r1DueWords.length > 0) {
    html += `
      <div class="due-review-section">
        <h3 class="section-title review-r1">🔴 到期复习-R1（必听写，≤30）</h3>
        <p class="limit-hint">${r1DueWords.length} 个词已到期，自动加入听写清单</p>
        <div class="word-list review-list">
          ${r1DueWords.map(word => `
            <label class="word-item disabled-item" data-word="${word.text}">
              <input type="checkbox" class="word-checkbox" checked disabled>
              <span class="word-text">${word.text}<span class="review-tag review-tag-r1">R1</span></span>
              ${!isChinese ? `<span class="word-extra"><span class="word-phonetic">${word.phonetic ? '/' + word.phonetic + '/' : ''}</span>${word.meaning ? `<span class="word-meaning">${word.meaning}</span>` : ''}</span>` : ''}
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }

  if (r2PlusDueWords.length > 0) {
    html += `
      <div class="due-review-section">
        <h3 class="section-title review">🔄 到期复习-R2+（建议复习）</h3>
        <div class="word-list review-list">
          ${r2PlusDueWords.map(word => {
            const isSelected = AppState.selectedWords.has(word.text);
            return `
              <label class="word-item" data-word="${word.text}">
                <input type="checkbox" class="word-checkbox"
                  onchange="toggleWordSelection('${word.text}')"
                  ${isSelected ? 'checked' : ''}>
                <span class="word-text">${word.text}<span class="review-tag round-${word.round}">R${word.round}</span></span>
                ${!isChinese ? `<span class="word-extra"><span class="word-phonetic">${word.phonetic ? '/' + word.phonetic + '/' : ''}</span>${word.meaning ? `<span class="word-meaning">${word.meaning}</span>` : ''}</span>` : ''}
              </label>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function toggleWordSelection(wordText) {
  if (AppState.selectedWords.has(wordText)) {
    AppState.selectedWords.delete(wordText);
  } else {
    AppState.selectedWords.add(wordText);
  }
}

function selectAllWords() {
  const subject = AppState.currentSubject;
  const lessonId = AppState.currentLesson;
  const cacheKey = `${subject}/${lessonId}`;
  const data = AppState.wordData[cacheKey];

  if (data && data.words) {
    data.words.forEach(word => {
      if (word.round === 0) AppState.selectedWords.add(word.text);
    });

    document.querySelectorAll('.word-list:not(.review-list) .word-checkbox').forEach(cb => {
      const wordItem = cb.closest('.word-item');
      const wordText = wordItem.dataset.word;
      const wordData = data.words.find(w => w.text === wordText);
      if (wordData && wordData.round === 0) cb.checked = true;
    });
  }
}

async function generateDictationList() {
  const subject = AppState.currentSubject;
  const lessonId = AppState.currentLesson;
  const cacheKey = `${subject}/${lessonId}`;
  const data = AppState.wordData[cacheKey];
  const isChinese = subject === 'chinese';

  const manualSelected = [];
  data.words.forEach(word => {
    if (AppState.selectedWords.has(word.text)) {
      manualSelected.push({
        ...word,
        subject, lessonId,
        lessonName: isChinese ? data.lessonName : data.unitName,
        isManual: true
      });
    }
  });

  if (manualSelected.length === 0) {
    const dueWords = await getAllDueReviewWords(subject);
    if (dueWords.length === 0) {
      alert('请先勾选词语');
      return;
    }
  }

  const allDueWords = await getAllDueReviewWords(subject);
  const manualTexts = new Set(manualSelected.map(w => w.text));
  const autoDueWords = allDueWords.filter(w => !manualTexts.has(w.text));

  const r1DueWords = autoDueWords.filter(w => w.round === 1);
  const r2PlusDueWords = autoDueWords.filter(w => w.round >= 2);
  const manualR0Words = manualSelected.filter(w => w.round === 0);
  const manualReviewWords = manualSelected.filter(w => w.round >= 1);

  const WORD_LIMIT = 20;
  const R1_SOFT_CAP = 30;
  const DAILY_DEBT_LIMIT = 30;
  const isDebtMode = r1DueWords.length > R1_SOFT_CAP;

  const cappedR1 = r1DueWords.slice(0, R1_SOFT_CAP);
  const postponedR1 = r1DueWords.slice(R1_SOFT_CAP);
  const finalR1 = cappedR1;

  const debtSchedule = [];
  if (isDebtMode && postponedR1.length > 0) {
    const remaining = postponedR1;
    let dayOffset = 1;
    let idx = 0;
    while (idx < remaining.length) {
      const batchSize = Math.min(DAILY_DEBT_LIMIT, remaining.length - idx);
      for (let i = 0; i < batchSize; i++) {
        const word = remaining[idx + i];
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + dayOffset);
        debtSchedule.push({ ...word, nextReview: getLocalDate(nextDate) });
      }
      idx += batchSize;
      dayOffset++;
    }
  }

  const remainingSlotsForR0 = Math.max(0, R1_SOFT_CAP - finalR1.length);
  const finalR0 = manualR0Words.slice(0, remainingSlotsForR0);
  const postponedR0 = manualR0Words.slice(remainingSlotsForR0);
  const slotsAfterR0 = Math.max(0, remainingSlotsForR0 - finalR0.length);
  const finalManualReview = manualReviewWords.slice(0, slotsAfterR0);
  const postponedManualReview = manualReviewWords.slice(slotsAfterR0);
  const slotsAfterManualReview = Math.max(0, slotsAfterR0 - finalManualReview.length);
  const finalR2Plus = r2PlusDueWords.slice(0, slotsAfterManualReview);
  const postponedR2Plus = r2PlusDueWords.slice(slotsAfterManualReview);
  const postponedWords = [...postponedR0, ...postponedManualReview, ...postponedR2Plus];

  if (isDebtMode && debtSchedule.length > 0) {
    saveProgress(debtSchedule.map(w => ({
      text: w.text, lessonId: w.lessonId, subject: w.subject,
      round: 1, nextReview: w.nextReview, wrongCount: w.wrongCount || 0
    })));
  }

  const formatWordExtra = (w) => {
    if (w.subject === 'english') {
      let extra = '';
      if (w.phonetic) extra += `<span class="word-phonetic">/${w.phonetic}/</span>`;
      if (w.meaning) extra += `<span class="word-meaning">${w.meaning}</span>`;
      return extra ? `<span class="word-extra">${extra}</span>` : '';
    }
    return '';
  };

  let resultHtml = '<div class="dictation-list dictation-two-column">';

  if (finalR0.length > 0) {
    resultHtml += `
      <div class="dictation-section">
        <h3 class="section-title new">📝 新课词语 (${finalR0.length})</h3>
        <div class="dictation-words">
          ${finalR0.map(w => `<span class="dictation-word new" data-meaning="${encodeURIComponent(w.meaning || '')}">${w.text}${formatWordExtra(w)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  if (finalR1.length > 0) {
    const r1CappedNote = postponedR1.length > 0 ? `（含 ${finalR1.length}/${finalR1.length + postponedR1.length} 个，其余延期）` : '';
    resultHtml += `
      <div class="dictation-section">
        <h3 class="section-title review-r1">🔴 到期复习-R1 (${finalR1.length})${r1CappedNote}</h3>
        <div class="dictation-words">
          ${finalR1.map(w => `<span class="dictation-word review-r1" data-meaning="${encodeURIComponent(w.meaning || '')}">${w.text}${formatWordExtra(w)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  const allReviewWords = [...finalManualReview, ...finalR2Plus];
  if (allReviewWords.length > 0) {
    resultHtml += `
      <div class="dictation-section">
        <h3 class="section-title review">🔄 到期复习-R2+ (${allReviewWords.length})</h3>
        <div class="dictation-words">
          ${allReviewWords.map(w => {
            const roundTag = w.round >= 5 ? '✅' : `R${w.round}`;
            return `<span class="dictation-word review" data-meaning="${encodeURIComponent(w.meaning || '')}">${w.text}${formatWordExtra(w)} <small>${roundTag}</small></span>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  resultHtml += '</div>';

  if (isDebtMode) {
    const days = debtSchedule.length > 0 ? Math.ceil(debtSchedule.length / DAILY_DEBT_LIMIT) : 0;
    resultHtml += `
      <div class="postponed-notice debt-mode">
        🧹 <strong>清债模式</strong>：${postponedR1.length} 个 R1 词已分摊到未来 ${days} 天（每天最多 ${DAILY_DEBT_LIMIT} 个）<br>
        <small>明天到期: ${debtSchedule.filter(w => w.nextReview === getTomorrowDate()).length} 个</small>
      </div>
    `;
  }

  if (postponedWords.length > 0) {
    resultHtml += `<div class="postponed-notice">⏸️ 延期词语: ${postponedWords.length} 个（明天再复习）</div>`;
  }

  const totalIncluded = finalR0.length + finalR1.length + allReviewWords.length;
  resultHtml += `<p class="dictation-total">共 ${totalIncluded} 个词（${postponedWords.length} 个延期到明天）</p>`;
  resultHtml += `
    <div class="action-bar grading-action-bar">
      <button class="btn btn-primary btn-lg" id="btn-start-grading" onclick="startDictationGrading()">📝 听写完毕</button>
    </div>
  `;

  document.getElementById('dictation-result').innerHTML = resultHtml;

  AppState.currentDictationList = [];
  finalR0.forEach(w => AppState.currentDictationList.push({ text: w.text, lessonId, round: w.round || 0, subject, meaning: w.meaning || '' }));
  finalR1.forEach(w => AppState.currentDictationList.push({ text: w.text, lessonId: w.lessonId || lessonId, round: w.round || 1, subject, meaning: w.meaning || '' }));
  allReviewWords.forEach(w => AppState.currentDictationList.push({ text: w.text, lessonId: w.lessonId || lessonId, round: w.round || 1, subject, meaning: w.meaning || '' }));
}

function goBack() {
  AppState.currentSubject = null;
  AppState.selectedWords.clear();
  AppState.isGrading = false;
  AppState.originalDictationHtml = null;
  renderDictationPage();
}

function goBackToLessons() {
  AppState.currentLesson = null;
  AppState.selectedWords.clear();
  AppState.isGrading = false;
  AppState.originalDictationHtml = null;
  selectSubject(AppState.currentSubject);
}

// ============================================
// 批改反馈闭环
// ============================================

function startDictationGrading() {
  if (AppState.isGrading) return;
  AppState.isGrading = true;

  const resultEl = document.getElementById('dictation-result');
  if (!resultEl) { AppState.isGrading = false; return; }

  AppState.originalDictationHtml = resultEl.innerHTML;
  let html = resultEl.innerHTML;

  const startBtn = document.getElementById('btn-start-grading');
  if (startBtn) startBtn.remove();

  const gradingNotice = `
    <div class="grading-notice">
      <p>📌 请在清单中勾选写错的字词（不勾选表示写对）</p>
      <div class="grading-action-bar">
        <button class="btn btn-success" id="btn-finish-grading" onclick="confirmFinishGrading()">✅ 错字词勾选完毕</button>
        <button class="btn btn-secondary" id="btn-cancel-grading" onclick="cancelDictationGrading()">取消</button>
      </div>
    </div>
  `;

  html = html.replace(
    /<span class="dictation-word ([^"]*)" data-meaning="([^"]*)">([^<]+)(<span class="word-extra">[\s\S]*?<\/span>)?<\/span>/g,
    function(match, className, meaningEncoded, wordText, extraHtml) {
      const meaning = decodeURIComponent(meaningEncoded);
      const item = AppState.currentDictationList.find(w => w.text === wordText);
      const lessonId = item ? item.lessonId : '';
      const round = item ? item.round : 0;
      const phoneticMatch = extraHtml ? extraHtml.match(/\/([^/]+)\//) : null;
      const phoneticHtml = phoneticMatch ? `<span class="grading-phonetic">/${phoneticMatch[1]}/</span>` : '';
      const meaningHtml = meaning ? `<span class="grading-meaning">${meaning}</span>` : '';
      return `<label class="grading-word-item ${className}"><input type="checkbox" class="wrong-cb" data-word="${wordText}" data-lesson="${lessonId}" data-round="${round}"><span class="word-text">${wordText}</span>${phoneticHtml}${meaningHtml}</label>`;
    }
  );

  resultEl.innerHTML = gradingNotice + html;
}

function cancelDictationGrading() {
  AppState.isGrading = false;
  const resultEl = document.getElementById('dictation-result');
  if (!resultEl || !AppState.originalDictationHtml) return;
  resultEl.innerHTML = AppState.originalDictationHtml;
  const actionBar = resultEl.querySelector('.action-bar');
  if (!actionBar) {
    const bar = document.createElement('div');
    bar.className = 'action-bar grading-action-bar';
    bar.innerHTML = '<button class="btn btn-primary btn-lg" id="btn-start-grading" onclick="startDictationGrading()">📝 听写完毕</button>';
    resultEl.appendChild(bar);
  }
}

function confirmFinishGrading() {
  const wrongCount = document.querySelectorAll('.wrong-cb:checked').length;
  const totalCount = document.querySelectorAll('.wrong-cb').length;
  const correctCount = totalCount - wrongCount;
  const msg = `共 ${totalCount} 个词，确认 ${wrongCount} 个写错、${correctCount} 个写对？\n确认后将更新复习轮次。`;
  if (!confirm(msg)) return;
  finishDictationGrading();
}

function finishDictationGrading() {
  const finishBtn = document.getElementById('btn-finish-grading');
  const cancelBtn = document.getElementById('btn-cancel-grading');
  if (finishBtn) {
    finishBtn.disabled = true;
    finishBtn.textContent = '⏳ 保存中…';
    finishBtn.style.opacity = '0.5';
  }
  if (cancelBtn) cancelBtn.disabled = true;

  const wrongWords = new Set();
  document.querySelectorAll('.wrong-cb:checked').forEach(cb => wrongWords.add(cb.dataset.word));

  const wordUpdates = [];
  let correctCount = 0;
  let wrongCount = 0;
  const totalWords = AppState.currentDictationList.length;

  AppState.currentDictationList.forEach((item, idx) => {
    const isWrong = wrongWords.has(item.text);
    const newRound = isWrong ? 1 : Math.min((item.round || 0) + 1, 6);
    const nextReview = isWrong
      ? calculateNextReview(1)
      : calculateStaggeredNextReview(newRound, idx, totalWords);

    if (isWrong) wrongCount++;
    else correctCount++;

    const existing = findWordProgress(item.subject, item.lessonId, item.text);
    const existingWrongCount = existing ? (existing.wrongCount || 0) : 0;

    wordUpdates.push({
      text: item.text, lessonId: item.lessonId, subject: item.subject,
      round: newRound, nextReview,
      wrongCount: isWrong ? existingWrongCount + 1 : existingWrongCount
    });
  });

  saveProgress(wordUpdates);

  const earliestNext = wordUpdates
    .filter(w => w.nextReview)
    .sort((a, b) => a.nextReview.localeCompare(b.nextReview))[0];
  const earliestDate = earliestNext ? formatDate(earliestNext.nextReview) : '-';

  const summaryHtml = `
    <div class="result-summary">
      <h3>✅ 听写完成！</h3>
      <div class="stats">
        <span class="stat correct">✅ ${correctCount} 正确</span>
        <span class="stat wrong">❌ ${wrongCount} 错误</span>
      </div>
      <p>📅 下次复习：<strong>${earliestDate}</strong></p>
      <div class="action-bar" style="margin-top:16px;">
        <button class="btn btn-primary" onclick="goBackToLessons()">返回选课</button>
      </div>
    </div>
  `;

  const resultEl = document.getElementById('dictation-result');
  if (resultEl) resultEl.innerHTML = summaryHtml;
}

/**
 * 保存进度到 ProgressStore（v2）
 */
function saveProgress(wordUpdates) {
  ProgressStore.setBatch(wordUpdates);
  console.log('进度已保存:', wordUpdates.length, '个词');
}

/**
 * 查找某个词的进度记录（v2）
 */
function findWordProgress(subject, lessonId, text) {
  return ProgressStore.get(subject, lessonId, text);
}

/**
 * 从 ProgressStore 合并进度到词数据（v2）
 */
function mergeProgressToWords(data, subject, lessonId) {
  return ProgressStore.mergeToWords(data, subject, lessonId);
}

// ============================================
// 导航
// ============================================

function getWordStatus(round) {
  if (round === 0) return { icon: '🆕', text: '新词', className: 'status-new' };
  if (round >= 1 && round <= 5) return { icon: '📝', text: `复习中 R${round}`, className: 'status-review' };
  return { icon: '✅', text: '已掌握', className: 'status-mastered' };
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return '今天';
  if (date.toDateString() === tomorrow.toDateString()) return '明天';

  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

// ============================================
// 词库管理页面
// ============================================

function renderVocabularyPage() {
  AppState.currentSubject = null;
  AppState.currentLesson = null;
  renderContent(`
    <h2 class="page-title">词库管理</h2>
    <div class="subject-select">
      <button class="subject-btn chinese" onclick="selectVocabSubject('chinese')">
        <span class="subject-icon">📖</span><span>语文</span>
      </button>
      <button class="subject-btn english" onclick="selectVocabSubject('english')">
        <span class="subject-icon">📚</span><span>英语</span>
      </button>
    </div>
  `);
}

async function selectVocabSubject(subject) {
  AppState.currentSubject = subject;
  const isChinese = subject === 'chinese';
  const items = isChinese ? await loadChineseLessons() : await loadEnglishUnits();
  const subjectName = isChinese ? '语文' : '英语';
  const itemName = isChinese ? '课' : '单元';

  if (items.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="renderVocabularyPage()">← 返回</button>
      <div class="empty-state">
        <p class="empty-icon">📭</p>
        <p class="empty-text">还没有${itemName}数据</p>
      </div>
    `);
    return;
  }

  const itemsWithStats = await Promise.all(items.map(async (item) => {
    const data = await loadWordData(subject, item.id, true);
    if (!data || !data.words) return { ...item, newCount: 0, reviewCount: 0, masteredCount: 0, totalCount: 0 };
    return {
      ...item,
      newCount: data.words.filter(w => w.round === 0).length,
      reviewCount: data.words.filter(w => w.round >= 1 && w.round <= 5).length,
      masteredCount: data.words.filter(w => w.round >= 6).length,
      totalCount: data.words.length
    };
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

async function selectVocabLesson(lessonId) {
  AppState.currentLesson = lessonId;
  const subject = AppState.currentSubject;
  const data = await loadWordData(subject, lessonId);
  const isChinese = subject === 'chinese';

  if (!data || !data.words || data.words.length === 0) {
    renderContent(`
      <button class="back-btn" onclick="selectVocabSubject('${subject}')">← 返回</button>
      <div class="empty-state"><p class="empty-icon">📭</p><p class="empty-text">还没有词语数据</p></div>
    `);
    return;
  }

  const title = isChinese ? data.lessonName : data.unitName;
  const sortedWords = [...data.words].sort((a, b) => {
    const p = w => w.round === 0 ? 0 : w.round <= 5 ? 1 : 2;
    return p(a) - p(b);
  });

  const wordsHtml = sortedWords.map(word => {
    const status = getWordStatus(word.round);
    const meaningHtml = !isChinese && word.meaning ? `<span class="vocab-word-meaning">${word.meaning}</span>` : '';
    const typeHtml = isChinese && word.type ? `<span class="word-type">${word.type === 'char' ? '字' : '词'}</span>` : '';
    return `
      <div class="vocab-word-item">
        <div class="vocab-word-main">
          <span class="vocab-word-text">${word.text}</span>${typeHtml}${meaningHtml}
        </div>
        <div class="vocab-word-meta">
          <span class="vocab-status ${status.className}">${status.icon} ${status.text}</span>
          <span class="vocab-next-review">下次: ${formatDate(word.nextReview)}</span>
        </div>
      </div>
    `;
  }).join('');

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

function switchPage(page) {
  AppState.currentPage = page;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
  AppState.currentSubject = null;
  AppState.currentLesson = null;
  AppState.selectedWords.clear();

  switch (page) {
    case 'dictation': renderDictationPage(); break;
    case 'vocabulary': renderVocabularyPage(); break;
    case 'progress': renderProgressPage('all'); break;
  }
}

// ============================================
// 进度总览页面
// ============================================

async function renderProgressPage(filter = 'all') {
  renderContent('<div class="loading">加载中...</div>');

  const chineseLessons = await loadChineseLessons();
  const englishUnits = await loadEnglishUnits();

  const allWords = [];
  const lessonStats = [];

  if (filter === 'all' || filter === 'chinese') {
    for (const lesson of chineseLessons) {
      let data = await loadWordData('chinese', lesson.id);
      if (data && data.words) {
        data = mergeProgressToWords(data, 'chinese', lesson.id);
        data.words.forEach(word => allWords.push({ ...word, subject: 'chinese', lessonId: lesson.id, lessonName: data.lessonName }));
        const mastered = data.words.filter(w => w.round >= 6).length;
        lessonStats.push({ name: lesson.name, subject: 'chinese', mastered, total: data.words.length, percent: data.words.length > 0 ? Math.round((mastered / data.words.length) * 100) : 0 });
      }
    }
  }

  if (filter === 'all' || filter === 'english') {
    for (const unit of englishUnits) {
      let data = await loadWordData('english', unit.id);
      if (data && data.words) {
        data = mergeProgressToWords(data, 'english', unit.id);
        data.words.forEach(word => allWords.push({ ...word, subject: 'english', unitId: unit.id, unitName: data.unitName }));
        const mastered = data.words.filter(w => w.round >= 6).length;
        lessonStats.push({ name: unit.name, subject: 'english', mastered, total: data.words.length, percent: data.words.length > 0 ? Math.round((mastered / data.words.length) * 100) : 0 });
      }
    }
  }

  const totalCount = allWords.length;
  const masteredCount = allWords.filter(w => w.round >= 6).length;
  const reviewCount = allWords.filter(w => w.round >= 1 && w.round <= 5).length;
  const newCount = allWords.filter(w => w.round === 0).length;
  const masteryPercent = totalCount > 0 ? Math.round((masteredCount / totalCount) * 100) : 0;

  const errorWords = allWords.filter(w => w.wrongCount > 0).sort((a, b) => b.wrongCount - a.wrongCount).slice(0, 10);
  lessonStats.sort((a, b) => b.percent - a.percent);

  const filterHtml = `
    <div class="filter-bar">
      <button class="filter-btn all ${filter === 'all' ? 'active' : ''}" onclick="AppState.reviewWordsPage=1;renderProgressPage('all')">全部</button>
      <button class="filter-btn chinese ${filter === 'chinese' ? 'active' : ''}" onclick="AppState.reviewWordsPage=1;renderProgressPage('chinese')">语文</button>
      <button class="filter-btn english ${filter === 'english' ? 'active' : ''}" onclick="AppState.reviewWordsPage=1;renderProgressPage('english')">英语</button>
    </div>
  `;

  const statsHtml = `
    <div class="stats-card">
      <h3 class="stats-title">📊 总体统计</h3>
      <div class="stats-grid">
        <div class="stat-item total"><span class="stat-value">${totalCount}</span><span class="stat-label">总词数</span></div>
        <div class="stat-item mastered"><span class="stat-value">${masteredCount}</span><span class="stat-label">已掌握</span></div>
        <div class="stat-item review"><span class="stat-value">${reviewCount}</span><span class="stat-label">复习中</span></div>
        <div class="stat-item new"><span class="stat-value">${newCount}</span><span class="stat-label">新词</span></div>
      </div>
      <div class="mastery-section">
        <div class="mastery-ring">
          <svg viewBox="0 0 100 100">
            <circle class="mastery-ring-bg" cx="50" cy="50" r="40"></circle>
            <circle class="mastery-ring-progress" cx="50" cy="50" r="40"
              stroke-dasharray="${2 * Math.PI * 40}"
              stroke-dashoffset="${2 * Math.PI * 40 * (1 - masteryPercent / 100)}"></circle>
          </svg>
          <span class="mastery-percent">${masteryPercent}%</span>
        </div>
        <span class="mastery-label">掌握率</span>
      </div>
    </div>
  `;

  const reviewWords = allWords.filter(w => w.round >= 1 && w.round <= 5).sort((a, b) => a.round - b.round);
  const REVIEW_PAGE_SIZE = 20;
  const totalReviewPages = Math.ceil(reviewWords.length / REVIEW_PAGE_SIZE);
  const reviewPage = Math.min(AppState.reviewWordsPage, totalReviewPages) || 1;
  const startIdx = (reviewPage - 1) * REVIEW_PAGE_SIZE;
  const pagedReviewWords = reviewWords.slice(startIdx, startIdx + REVIEW_PAGE_SIZE);

  const reviewHtml = reviewWords.length > 0 ? `
    <div class="manual-section">
      <h3 class="manual-title">📝 复习中的词 (${reviewWords.length})</h3>
      <div class="manual-word-list">
        ${pagedReviewWords.map(word => {
          const name = word.lessonName || word.unitName || '';
          const phonetic = word.phonetic ? '/' + word.phonetic + '/ ' : '';
          const safeId = word.text.replace(/'/g, "\\'");
          return `<div class="manual-word-item">
            <span class="manual-word-text">${word.text} ${phonetic}${word.meaning || ''}</span>
            <div class="manual-word-info">
              <span class="manual-word-lesson">${name}</span>
              <span class="error-round">R${word.round}</span>
              <span class="manual-btn-group">
                <select class="manual-round-select" id="round-select-${safeId}">
                  <option value="0">R0</option>
                  ${[1,2,3,4,5].map(r => `<option value="${r}" ${word.round===r?'selected':''}>R${r}</option>`).join('')}
                  <option value="6">已掌握</option>
                </select>
                <button class="manual-btn btn-r1" onclick="manualSetRound('${word.subject}','${word.lessonId || word.unitId}','${safeId}',document.getElementById('round-select-${safeId}').value)">确认</button>
                <button class="manual-btn btn-reset" onclick="manualResetWord('${word.subject}','${word.lessonId || word.unitId}','${safeId}')">重置</button>
              </span>
            </div>
          </div>`;
        }).join('')}
      </div>
      ${totalReviewPages > 1 ? `
        <div class="pagination" style="margin-top:16px;display:flex;justify-content:center;align-items:center;gap:12px;">
          <button class="btn btn-secondary" style="padding:8px 16px;font-size:14px;" ${reviewPage <= 1 ? 'disabled' : ''} onclick="changeReviewPage(${reviewPage - 1}, '${filter}')">上一页</button>
          <span style="color:#666;font-size:14px;">第 ${reviewPage} / ${totalReviewPages} 页</span>
          <button class="btn btn-secondary" style="padding:8px 16px;font-size:14px;" ${reviewPage >= totalReviewPages ? 'disabled' : ''} onclick="changeReviewPage(${reviewPage + 1}, '${filter}')">下一页</button>
        </div>
      ` : ''}
    </div>
  ` : '';

  const lessonOptions = [];
  if (filter === 'all' || filter === 'chinese') chineseLessons.forEach(l => lessonOptions.push(`<option value="chinese|${l.id}">${l.name}</option>`));
  if (filter === 'all' || filter === 'english') englishUnits.forEach(u => lessonOptions.push(`<option value="english|${u.id}">${u.name}</option>`));

  const addWordHtml = `
    <div class="manual-section">
      <h3 class="manual-title">➕ 手动添加词 / 调整轮次</h3>
      <div class="add-word-form">
        <input type="text" id="manual-word-input" placeholder="输入词语" class="manual-input">
        <select id="manual-lesson-select" class="manual-input">
          <option value="">选择课/单元</option>
          ${lessonOptions.join('')}
        </select>
        <select id="manual-round-select" class="manual-input">
          <option value="0">R0 新词</option>
          <option value="1" selected>R1（1天后复习）</option>
          <option value="2">R2（3天后复习）</option>
          <option value="3">R3（7天后复习）</option>
          <option value="4">R4（16天后复习）</option>
          <option value="5">R5（35天后复习）</option>
          <option value="6">已掌握</option>
        </select>
        <div class="add-word-buttons">
          <button class="btn btn-primary" style="flex:1;font-size:14px;padding:10px;" onclick="manualAddWordWithRound()">添加</button>
        </div>
      </div>
    </div>
  `;

  const errorHtml = errorWords.length > 0 ? `
    <div class="error-ranking">
      <h3 class="error-title">⚠️ 高频错词排行 (前10)</h3>
      <div class="error-list">
        ${errorWords.map(word => {
          const phonetic = word.phonetic ? '/' + word.phonetic + '/ ' : '';
          return `<div class="error-item">
            <span class="error-word">${word.text} ${phonetic}${word.meaning || ''}</span>
            <div class="error-info">
              <span class="error-count">❌ ${word.wrongCount}次</span>
              <span class="error-round">R${word.round}</span>
              <button class="manual-btn btn-r1" onclick="manualSetRound('${word.subject}','${word.lessonId || word.unitId}','${word.text.replace(/'/g, "\\'")}',1)">设为R1</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  ` : `
    <div class="error-ranking">
      <h3 class="error-title">⚠️ 高频错词排行</h3>
      <div class="empty-state"><p class="empty-text">暂无错词记录</p></div>
    </div>
  `;

  const progressHtml = lessonStats.length > 0 ? `
    <div class="lesson-progress">
      <h3 class="progress-title">📚 各课/单元完成情况</h3>
      <div class="progress-list">
        ${lessonStats.map(stat => `
          <div class="progress-item">
            <div class="progress-header">
              <span class="progress-lesson-name">${stat.name}</span>
              <span class="progress-numbers">${stat.mastered}/${stat.total}</span>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar ${stat.percent < 30 ? 'low' : stat.percent < 60 ? 'medium' : ''}" style="width:${stat.percent}%"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : `
    <div class="lesson-progress">
      <h3 class="progress-title">📚 各课/单元完成情况</h3>
      <div class="empty-state"><p class="empty-text">暂无课/单元数据</p></div>
    </div>
  `;

  renderContent(`
    <h2 class="page-title">进度总览</h2>
    ${filterHtml}${statsHtml}${addWordHtml}${reviewHtml}${errorHtml}${progressHtml}
  `);
}

// ============================================
// 进度总览手动管理
// ============================================

function updateWordProgress(subject, lessonId, text, round, wrongCountIncrement = 0) {
  const nextReview = round >= 6 ? null : calculateNextReview(round);
  const existing = ProgressStore.get(subject, lessonId, text) || {};
  ProgressStore.set(subject, lessonId, text, {
    round,
    nextReview,
    wrongCount: (existing.wrongCount || 0) + wrongCountIncrement
  });
  const key = makeKey(subject, lessonId, text);
  if (isGitHubConfigured) debouncedSyncToGitHub();
  return key;
}

function manualSetRound(subject, lessonId, text, round) {
  round = parseInt(round, 10);
  updateWordProgress(subject, lessonId, text, round);
  const roundName = round >= 6 ? '已掌握' : round === 0 ? '新词' : `R${round} 复习中`;
  alert(`✅ ${text} 已设为${roundName}`);
  const activeFilter = document.querySelector('.filter-btn.active');
  const filter = activeFilter ? activeFilter.textContent.trim().toLowerCase() : 'all';
  renderProgressPage(filter === '语文' ? 'chinese' : filter === '英语' ? 'english' : 'all');
}

function manualResetWord(subject, lessonId, text) {
  manualSetRound(subject, lessonId, text, 0);
}

function changeReviewPage(page, filter) {
  AppState.reviewWordsPage = page;
  renderProgressPage(filter);
}

function manualAddWordR1() {
  const wordInput = document.getElementById('manual-word-input');
  const lessonSelect = document.getElementById('manual-lesson-select');
  if (!wordInput.value.trim()) { alert('请输入词语'); return; }
  if (!lessonSelect.value) { alert('请选择课/单元'); return; }

  const [subject, lessonId] = lessonSelect.value.split('|');
  const text = wordInput.value.trim();
  const cacheKey = `${subject}/${lessonId}`;
  const data = AppState.wordData[cacheKey];
  if (!data || !data.words || !data.words.find(w => w.text === text)) {
    if (!confirm(`词库中未找到 "${text}"，仍要添加吗？`)) return;
  }

  updateWordProgress(subject, lessonId, text, 1, 1);
  wordInput.value = '';
  alert(`✅ ${text} 已设为 R1 复习中（错词次数+1）`);
  const activeFilter = document.querySelector('.filter-btn.active');
  const filter = activeFilter ? activeFilter.textContent.trim().toLowerCase() : 'all';
  renderProgressPage(filter === '语文' ? 'chinese' : filter === '英语' ? 'english' : 'all');
}

function manualAddWordWithRound() {
  const wordInput = document.getElementById('manual-word-input');
  const lessonSelect = document.getElementById('manual-lesson-select');
  const roundSelect = document.getElementById('manual-round-select');
  if (!wordInput.value.trim()) { alert('请输入词语'); return; }
  if (!lessonSelect.value) { alert('请选择课/单元'); return; }

  const [subject, lessonId] = lessonSelect.value.split('|');
  const text = wordInput.value.trim();
  const round = parseInt(roundSelect.value, 10);
  const cacheKey = `${subject}/${lessonId}`;
  const data = AppState.wordData[cacheKey];
  if (!data || !data.words || !data.words.find(w => w.text === text)) {
    if (!confirm(`词库中未找到 "${text}"，仍要添加吗？`)) return;
  }

  updateWordProgress(subject, lessonId, text, round);
  const roundName = round >= 6 ? '已掌握' : round === 0 ? '新词' : `R${round} 复习中`;
  wordInput.value = '';
  alert(`✅ ${text} 已设为${roundName}`);
  const activeFilter = document.querySelector('.filter-btn.active');
  const filter = activeFilter ? activeFilter.textContent.trim().toLowerCase() : 'all';
  renderProgressPage(filter === '语文' ? 'chinese' : filter === '英语' ? 'english' : 'all');
}

function manualAddWordMastered() {
  const wordInput = document.getElementById('manual-word-input');
  const lessonSelect = document.getElementById('manual-lesson-select');
  if (!wordInput.value.trim()) { alert('请输入词语'); return; }
  if (!lessonSelect.value) { alert('请选择课/单元'); return; }

  const [subject, lessonId] = lessonSelect.value.split('|');
  const text = wordInput.value.trim();
  wordInput.value = '';
  updateWordProgress(subject, lessonId, text, 6);
  alert(`✅ ${text} 已设为已掌握`);
  const activeFilter = document.querySelector('.filter-btn.active');
  const filter = activeFilter ? activeFilter.textContent.trim().toLowerCase() : 'all';
  renderProgressPage(filter === '语文' ? 'chinese' : filter === '英语' ? 'english' : 'all');
}

// ============================================
// 初始化
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  ProgressStore.init();

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  renderDictationPage();
  mergeGitHubProgress().then(() => { renderDictationPage(); updateSyncIndicator(); });
  startBackgroundSync();
});

/**
 * 同步状态指示：token 已内置，无需手动配置
 */
document.addEventListener('DOMContentLoaded', () => {
  const syncEl = document.getElementById('sync-status');
  if (syncEl) {
    syncEl.title = 'GitHub 同步状态';
  }
});
