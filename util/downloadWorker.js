const { parentPort, workerData } = require('worker_threads');
const { saveDraftBackground } = require('./saveDraftBackground');
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const path = require('path');
const fs = require('fs');

// 初始化i18next
function initI18n() {
  const localesPath = path.join(process.env.LOCALES_PATH || path.join(__dirname, '../locales'));
  
  return i18next.use(Backend).init({
    backend: {
      loadPath: path.join(localesPath, '{{lng}}/{{ns}}.json')
    },
    fallbackLng: 'zh',
    debug: false,
    interpolation: {
      escapeValue: false
    }
  });
}

// 在开始下载前初始化i18next
initI18n().then(() => runDownload());

async function runDownload() {
  try {
    const { draft_id, draftFolder, taskId, is_capcut, apiKey, apiHost } = workerData;
    
    // 创建进度回调函数，将进度消息发送回主线程
    const progressCallback = (progress, message) => {
      parentPort.postMessage({
        type: 'progress',
        progress,
        message
      });
    };
    
    // 调用saveDraftBackground函数
    const result = await saveDraftBackground(draft_id, draftFolder, taskId, progressCallback, is_capcut, apiKey, apiHost);
    
    if (result.success) {
      // 下载完成，发送完成消息
      parentPort.postMessage({
        type: 'complete',
        message: result.message || '下载完成！'
      });
    } else {
      // 下载失败，发送错误消息
      parentPort.postMessage({
        type: 'error',
        message: result.message || '下载失败',
        error: result.error || '未知错误'
      });
    }
  } catch (error) {
    // 发生异常，发送错误消息
    parentPort.postMessage({
      type: 'error',
      message: '处理过程中发生错误',
      error: error.message || '未知错误'
    });
  }
}

// 运行下载任务
runDownload();