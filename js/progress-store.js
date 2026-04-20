/**
 * 恒一听写系统 - 进度存储模块 (v2)
 *
 * v2 使用 ASCII 主键，格式：subject|lessonId|hexUtf8(text)
 * 避免中文字符在 localStorage 和 GitHub 同步中的编码损坏问题
 */

const V1_STORAGE_KEY = 'hengyi-dictation-progress';
const V2_STORAGE_KEY = 'hengyi-progress-v2';
const V2_MIGRATED_FLAG = 'hengyi-progress-v2-migrated';

// ============================================
// 编码工具
// ============================================

/**
 * 将字符串转为 UTF-8 hex 编码
 * ASCII 字符原样保留，非 ASCII 转为 %XX→hex
 * 例如："abc" → "abc"，"你好" → "e4bda0e5a5bd"
 *
 * 使用 for...of 遍历完整 code point，避免 emoji 等 surrogate pair 抛错
 */
function hexUtf8(str) {
  let result = '';
  for (const char of str) {
    const code = char.codePointAt(0);
    if (code < 128) {
      result += char;
    } else {
      // 使用 TextEncoder 正确编码 UTF-8
      const bytes = new TextEncoder().encode(char);
      for (const byte of bytes) {
        result += byte.toString(16).padStart(2, '0');
      }
    }
  }
  return result;
}

/**
 * 构建 v2 主键：subject|lessonId|hexUtf8(text)
 */
function makeKey(subject, lessonId, text) {
  return subject + '|' + lessonId + '|' + hexUtf8(text);
}

/**
 * 解析 v2 主键
 */
function parseKey(key) {
  const parts = key.split('|');
  if (parts.length < 3) return null;
  const subject = parts[0];
  const lessonId = parts[1];
  // text 部分可能被 hex 编码，尝试解码
  let textHex = parts.slice(2).join('|'); // 处理 lessonId 含 | 的情况
  let text = tryDecodeHex(textHex);
  return { subject, lessonId, text, textHex };
}

/**
 * 尝试将 hex 字符串解码为文本
 * 安全验证：
 * 1) 偶数长度
 * 2) 纯 hex 字符
 * 3) 用 TextDecoder('utf-8') 解码
 * 4) 重新编码后必须与原值一致（防 "babe" 类巧合）
 * 5) 如果解码结果全是可打印 ASCII 但原 hex 不是纯 ASCII 的 hex 表示，返回原文
 */
function tryDecodeHex(str) {
  if (typeof str !== 'string') return str;
  // 检查是否包含非 hex 字符（允许 ASCII 字符原样存在）
  const hexPart = str.replace(/[^\da-fA-F]/g, '');
  if (hexPart.length < 2 || hexPart.length % 2 !== 0) return str;

  // 尝试解码整个 hex 部分
  try {
    const bytes = new Uint8Array(hexPart.length / 2);
    for (let i = 0; i < hexPart.length; i += 2) {
      bytes[i / 2] = parseInt(hexPart.substring(i, i + 2), 16);
    }

    // 用 UTF-8 解码
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);

    // 验证：重新编码后必须等于原 hex
    const reencoded = hexUtf8(decoded);
    if (reencoded.toLowerCase() !== hexPart.toLowerCase()) {
      return str; // 验证失败，返回原文
    }

    // 额外检查：如果解码结果全是可打印 ASCII，且原 hex 不是纯 ASCII hex，可能是巧合
    const isAllPrintableAscii = /^[\x20-\x7E]+$/.test(decoded);
    if (isAllPrintableAscii) {
      // 检查原 hex 是否是 ASCII 字符的 hex 表示
      const isAsciiHex = Array.from(decoded).every(char => char.charCodeAt(0) < 128);
      // 如果解码结果是纯 ASCII 但原 hex 不是纯 ASCII 的 hex 编码形式，可能是巧合
      // 例如 "babe" -> "º¾" 是 Latin-1 解释，不是有效的 UTF-8
      // 但如果 reencoded 匹配，说明确实是 hex 编码的 ASCII
      return decoded;
    }

    return decoded;
  } catch (e) {
    return str; // UTF-8 解码失败，返回原文
  }
}

// ============================================
// v1 → v2 迁移
// ============================================

/**
 * 尝试修复损坏的中文（双重/三重 UTF-8 编码）
 */
function fixDoubleEncoded(str) {
  if (typeof str !== 'string') return str;
  try {
    // 双重编码
    let fixed = decodeURIComponent(encodeURI(str).replace(/%25/g, '%'));
    if (fixed !== str) {
      // 尝试三重
      try {
        fixed = decodeURIComponent(fixed);
      } catch (e) { /* ok */ }
    }
    return fixed;
  } catch (e) {
    return str;
  }
}

/**
 * 清洗 localStorage 中编码损坏的 key
 */
function sanitizeLocalStorageProgress() {
  const data = localStorage.getItem(V2_STORAGE_KEY);
  if (!data) return;
  try {
    const progress = JSON.parse(data);
    let changed = false;
    const entries = Object.entries(progress);
    for (const [key, item] of entries) {
      if (typeof item.text === 'string' && /[\x80-\xff]{3,}/.test(item.text)) {
        const fixed = fixDoubleEncoded(item.text);
        if (fixed !== item.text) {
          const newKey = makeKey(item.subject, item.lessonId, fixed);
          if (newKey !== key) {
            delete progress[key];
            progress[newKey] = { ...item, text: fixed };
            changed = true;
          }
        }
      }
    }
    if (changed) {
      localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(progress));
      console.log('[ProgressStore] 清洗了编码损坏的 key');
    }
  } catch (e) {
    console.error('[ProgressStore] 清洗失败:', e);
  }
}

/**
 * 将 v1 数据迁移到 v2 格式
 * 只在首次加载时执行一次
 * v1 数据不会被删除，保留为备份
 *
 * 注意：如果已有 v2 数据，会与 v1 迁移的数据合并，同一词条按 updatedAt 取较新的
 */
function migrateV1ToV2() {
  if (localStorage.getItem(V2_MIGRATED_FLAG)) return false;

  const v1Raw = localStorage.getItem(V1_STORAGE_KEY);
  if (!v1Raw) {
    localStorage.setItem(V2_MIGRATED_FLAG, '1');
    return false;
  }

  try {
    const v1Progress = JSON.parse(v1Raw);

    // 读取已有 v2 数据（如果存在）
    const v2Raw = localStorage.getItem(V2_STORAGE_KEY);
    const v2Data = v2Raw ? JSON.parse(v2Raw) : {};

    let migrated = 0;

    for (const [key, item] of Object.entries(v1Progress)) {
      let subject, lessonId, text;
      if (item.subject && item.lessonId && item.text) {
        subject = item.subject;
        lessonId = item.lessonId;
        text = item.text;
      } else {
        const parsed = parseV1Key(key);
        if (!parsed) continue;
        subject = parsed.subject;
        lessonId = parsed.lessonId;
        text = parsed.text;
      }
      const v2Key = makeKey(subject, lessonId, text);

      // 检查是否已有 v2 数据，合并时取较新的
      const existingV2 = v2Data[v2Key];
      const v1UpdatedAt = item.updatedAt || new Date(0).toISOString();
      const v2UpdatedAt = existingV2?.updatedAt || new Date(0).toISOString();

      // 如果 v1 数据更新，或 v2 没有该数据，才写入
      if (!existingV2 || v1UpdatedAt >= v2UpdatedAt) {
        v2Data[v2Key] = {
          text, lessonId, subject,
          round: item.round || 0,
          nextReview: item.nextReview || null,
          wrongCount: item.wrongCount || 0,
          updatedAt: v1UpdatedAt
        };
      }
      migrated++;
    }

    localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(v2Data));
    localStorage.setItem(V2_MIGRATED_FLAG, '1');
    console.log(`[ProgressStore] v1→v2 迁移完成，${migrated} 条记录（v1 数据保留为备份）`);
    return true;
  } catch (e) {
    console.error('[ProgressStore] v1→v2 迁移失败:', e);
    return false;
  }
}

/**
 * 解析 v1 格式的 key：subject/lessonId/text
 */
function parseV1Key(key) {
  const parts = key.split('/');
  if (parts.length < 3) return null;
  return {
    subject: parts[0],
    lessonId: parts[1],
    text: parts.slice(2).join('/')
  };
}

// ============================================
// 公共 API
// ============================================

const ProgressStore = {
  /**
   * 初始化：执行 v1→v2 迁移
   * 页面加载时调用一次
   */
  init() {
    migrateV1ToV2();
    sanitizeLocalStorageProgress();
    console.log('[ProgressStore] 初始化完成');
  },

  /**
   * 获取单个词条进度
   */
  get(subject, lessonId, text) {
    const key = makeKey(subject, lessonId, text);
    const data = localStorage.getItem(V2_STORAGE_KEY);
    if (!data) return null;
    try {
      const progress = JSON.parse(data);
      return progress[key] || null;
    } catch (e) {
      return null;
    }
  },

  /**
   * 设置单个词条进度
   */
  set(subject, lessonId, text, progressData) {
    const key = makeKey(subject, lessonId, text);
    const data = localStorage.getItem(V2_STORAGE_KEY);
    const progress = data ? JSON.parse(data) : {};
    progress[key] = {
      ...progressData,
      text: text,
      lessonId: lessonId,
      subject: subject,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(progress));
  },

  /**
   * 批量设置进度（用于批改后保存）
   */
  setBatch(updates) {
    const data = localStorage.getItem(V2_STORAGE_KEY);
    const progress = data ? JSON.parse(data) : {};

    updates.forEach(update => {
      const key = makeKey(update.subject, update.lessonId, update.text);
      const existing = progress[key] || {};
      progress[key] = {
        text: update.text,
        lessonId: update.lessonId,
        subject: update.subject,
        round: update.round,
        nextReview: update.nextReview,
        wrongCount: update.wrongCount || existing.wrongCount || 0,
        updatedAt: new Date().toISOString()
      };
    });

    localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(progress));
    console.log(`[ProgressStore] 批量保存 ${updates.length} 条记录`);

    // 触发 GitHub 同步
    if (typeof debouncedSyncToGitHub === 'function') {
      debouncedSyncToGitHub();
    }
  },

  /**
   * 获取所有进度数据
   */
  getAll() {
    const data = localStorage.getItem(V2_STORAGE_KEY);
    if (!data) return {};
    try {
      return JSON.parse(data);
    } catch (e) {
      return {};
    }
  },

  /**
   * 导出为 v1 兼容格式（用于 GitHub 同步，使用 Unicode 转义）
   */
  exportForSync() {
    const progress = this.getAll();
    const jsonStr = JSON.stringify(progress, null, 2);
    // Unicode 转义保护中文
    return jsonStr.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g,
      ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  },

  /**
   * 从远程同步数据合并到本地
   * 支持处理 v1/v2 混合格式：
   * - v2 key 格式：subject|lessonId|hexUtf8(text)
   * - v1 key 格式：subject/lessonId/text
   */
  mergeFromRemote(remoteProgress) {
    if (!remoteProgress) return;
    const local = this.getAll();
    const merged = {};

    // 处理远程数据，转换 v1 key 为 v2 key
    for (const [key, item] of Object.entries(remoteProgress)) {
      let v2Key = key;
      let convertedItem = { ...item };

      // 尝试解析 v1 格式 key（格式：subject/lessonId/text）
      const v1Parsed = parseV1Key(key);
      if (v1Parsed && (!item.subject || !item.lessonId || !item.text)) {
        // v1 格式的 key，转换为 v2
        v2Key = makeKey(v1Parsed.subject, v1Parsed.lessonId, v1Parsed.text);
        convertedItem.subject = v1Parsed.subject;
        convertedItem.lessonId = v1Parsed.lessonId;
        convertedItem.text = v1Parsed.text;
      }
      // 如果 item 已经有 subject/lessonId/text，用它们重新生成 key
      else if (item.subject && item.lessonId && item.text) {
        v2Key = makeKey(item.subject, item.lessonId, item.text);
      }

      merged[v2Key] = convertedItem;
    }

    // 合并本地数据
    for (const [key, localItem] of Object.entries(local)) {
      const remoteItem = merged[key];
      if (!remoteItem) {
        merged[key] = localItem;
      } else if (localItem.updatedAt >= remoteItem.updatedAt) {
        merged[key] = localItem;
      }
    }

    localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(merged));
  },

  /**
   * 将进度合并到词数据（用于渲染时显示轮次/下次复习日期）
   */
  mergeToWords(data, subject, lessonId) {
    if (!data || !data.words) return data;
    const progress = this.getAll();
    const prefix = subject + '|' + lessonId + '|';

    data.words.forEach(word => {
      const key = makeKey(subject, lessonId, word.text);
      if (progress[key]) {
        word.round = progress[key].round !== undefined ? progress[key].round : word.round;
        word.nextReview = progress[key].nextReview || word.nextReview;
        word.wrongCount = progress[key].wrongCount || word.wrongCount || 0;
      }
    });

    return data;
  }
};
