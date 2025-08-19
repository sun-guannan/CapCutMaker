const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { promisify } = require('util');
const axios = require('axios');
const downloader = require('./downloader');
const { log } = require('console');

// 获取 i18next 实例
const i18next = require('i18next');

// 日志记录器
const logger = {
  info: (message) => console.log(`[INFO] ${message}`),
  warning: (message) => console.warn(`[WARNING] ${message}`),
  error: (message, error) => console.error(`[ERROR] ${message}`, error)
};

/**
 * 构建资源文件路径
 * @param {string} draftFolder - 草稿文件夹路径
 * @param {string} draftId - 草稿ID
 * @param {string} assetType - 资源类型（audio, image, video）
 * @param {string} materialName - 素材名称
 * @returns {string} - 构建好的路径
 */
function buildAssetPath(draftFolder, draftId, assetType, materialName) {
  // 简化版本，仅处理macOS/Linux路径
  return path.join(draftFolder, draftId, "assets", assetType, materialName);
}

/**
 * 递归复制文件夹
 * @param {string} source - 源文件夹路径
 * @param {string} destination - 目标文件夹路径
 * @returns {Promise<void>}
 */
async function copyFolderRecursive(source, destination) {
  // 确保目标文件夹存在
  if (!fs.existsSync(destination)) {
    await fs.promises.mkdir(destination, { recursive: true });
  }

  // 读取源文件夹中的所有文件和子文件夹
  const entries = await fs.promises.readdir(source, { withFileTypes: true });

  // 遍历并复制每个文件和子文件夹
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      // 递归复制子文件夹
      await copyFolderRecursive(srcPath, destPath);
    } else {
      // 复制文件
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

/**
 * 后台保存草稿到OSS
 * @param {string} draftId - 草稿ID
 * @param {string} draftFolder - 草稿文件夹路径
 * @param {string} taskId - 任务ID
 * @param {Function} progressCallback - 进度回调函数
 * @param {boolean} is_capcut - 是否为CapCut
 * @param {string} apiKey - API密钥
 * @returns {Promise<Object>} - 返回结果对象 {success: boolean, error: string, message: string}
 */
async function saveDraftBackground(draftId, draftFolder, taskId, progressCallback, is_capcut, apiKey) {
  try {
    // 初始化进度
    if (progressCallback) {
      progressCallback(5, i18next.t('getting_draft_info'));
    }
    
    // 1.从API获取草稿信息
    let script;
    console.log('is_capcut_', is_capcut)
    try {
        const response = await axios.post('https://open.capcutapi.top/cut_capcut/query_script', 
            { 
              draft_id: draftId,
              is_capcut: is_capcut
            },
            { 
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            }
        );

        if (response.data && response.data.success) {
            script = JSON.parse(JSON.parse(JSON.stringify(response.data)).output);
            logger.info(`成功从API获取草稿 ${draftId}。`);
        } else {
            throw new Error(`${JSON.parse(JSON.stringify(response.data)).error}`);
        }
    } catch (error) {
      logger.error(`无法从API获取草稿 ${draftId}，任务 ${taskId} 失败。`, error);
      if (progressCallback) {
        progressCallback(-1, i18next.t('cannot_get_draft_info', { error: error.message }));
      }
      return { success: false, error: error.message, message: i18next.t('cannot_get_draft_info', { error: error.message }) };
    }
    
    if (progressCallback) {
      progressCallback(10, i18next.t('preparing_draft_files'));
    }
    
    logger.info(`任务 ${taskId} 状态更新为 'processing'：正在准备草稿文件。`);
    
    // 删除可能已存在的草稿文件夹
    const draftPath = path.join(draftFolder, draftId);
    if (fs.existsSync(draftPath)) {
      logger.warning(`删除已存在的草稿文件夹: ${draftPath}`);
      await fs.promises.rm(draftPath, { recursive: true, force: true });
    }

    logger.info(`开始保存草稿: ${draftId}`);
    
    // 根据配置选择不同的模板目录
    const templateDir = is_capcut ? "template" : "template_jianying";
    
    // 获取应用程序根目录
    const appRoot = path.join(__dirname, '..');
    
    // 复制模板目录到草稿路径
    const templatePath = path.join(appRoot, templateDir);
    logger.info(`复制模板目录 ${templatePath} 到草稿路径 ${draftPath}`);
    await copyFolderRecursive(templatePath, draftPath);
    logger.info(`模板目录复制完成`);
    
    if (progressCallback) {
      progressCallback(20, i18next.t('collecting_download_tasks'));
    }
    
    // 收集下载任务
    const downloadTasks = [];
    
    // 收集音频下载任务
    const audios = script.materials.audios;
    if (audios && audios.length > 0) {
      for (const audio of audios) {
        const remoteUrl = audio.remote_url;
        const materialName = audio.name;
        // 使用辅助函数构建路径
        if (draftFolder) {
          audio.path = buildAssetPath(draftFolder, draftId, "audio", materialName);
        }
        if (!remoteUrl) {
          logger.warning(`音频文件 ${materialName} 没有 remote_url，跳过下载。`);
          continue;
        }
        
        // 添加音频下载任务
        downloadTasks.push({
          type: 'audio',
          func: downloader.downloadFile,
          args: [remoteUrl, buildAssetPath(draftFolder, draftId, "audio", materialName)],
          material: audio
        });
      }
    }
    
    // 收集视频和图片下载任务
    const videos = script.materials.videos;
    if (videos && videos.length > 0) {
      for (const video of videos) {
        const remoteUrl = video.remote_url;
        const materialName = video.material_name;
        
        if (video.type === 'photo') {
          // 使用辅助函数构建路径
          if (draftFolder) {
            video.path = buildAssetPath(draftFolder, draftId, "image", materialName);
          }
          if (!remoteUrl) {
            logger.warning(`图片文件 ${materialName} 没有 remote_url，跳过下载。`);
            continue;
          }
          
          // 添加图片下载任务
          downloadTasks.push({
            type: 'image',
            func: downloader.downloadFile,
            args: [remoteUrl, buildAssetPath(draftFolder, draftId, "image", materialName)],
            material: video
          });
        } else if (video.type === 'video') {
          // 使用辅助函数构建路径
          if (draftFolder) {
            video.path = buildAssetPath(draftFolder, draftId, "video", materialName);
          }
          if (!remoteUrl) {
            logger.warning(`视频文件 ${materialName} 没有 remote_url，跳过下载。`);
            continue;
          }
          
          // 添加视频下载任务
          downloadTasks.push({
            type: 'video',
            func: downloader.downloadFile,
            args: [remoteUrl, buildAssetPath(draftFolder, draftId, "video", materialName)],
            material: video
          });
        }
      }
    }

    logger.info(`任务 ${taskId} 进度10%：共收集到 ${downloadTasks.length} 个下载任务。`);
    if (progressCallback) {
      progressCallback(30, i18next.t('start_downloading', { count: downloadTasks.length }));
    }

    // 并发执行所有下载任务
    const downloadedPaths = [];
    let completedFiles = 0;
    if (downloadTasks.length > 0) {
      logger.info(`开始并发下载 ${downloadTasks.length} 个文件...`);
      
      // 使用Promise.all并发下载，最大并发数为16
      // 这里简化处理，实际可能需要更复杂的并发控制
      const batchSize = 16;
      const batches = [];
      
      for (let i = 0; i < downloadTasks.length; i += batchSize) {
        batches.push(downloadTasks.slice(i, i + batchSize));
      }
      
      for (const batch of batches) {
        const promises = batch.map(task => {
          return (async () => {
            try {
              const localPath = await task.func(...task.args);
              downloadedPaths.push(localPath);
              
              // 更新任务状态 - 更新已完成文件数和进度
              completedFiles += 1;
              const total = downloadTasks.length;
              const downloadProgress = Math.floor(30 + (completedFiles / total) * 40); // 从30%到70%的进度
              
              if (progressCallback) {
                progressCallback(downloadProgress, `已下载 ${completedFiles}/${total} 个文件...`);
              }
              
              logger.info(`任务 ${taskId}：成功下载 ${task.type} 文件。进度: ${completedFiles}/${total}`);
              return localPath;
            } catch (error) {
              logger.error(`任务 ${taskId}：下载 ${task.type} 文件失败:`, error);
              // 继续处理其他文件，不中断整个流程
              if (progressCallback) {
                progressCallback(-1, `下载文件失败: ${error.message}，继续处理其他文件...`);
              }
              return null;
            }
          })();
        });
        
        await Promise.all(promises);
      }
      
      logger.info(`任务 ${taskId}：并发下载完成，共下载 ${downloadedPaths.length} 个文件。`);
    }
    
    // 更新任务状态 - 开始保存草稿信息
    if (progressCallback) {
      progressCallback(70, i18next.t('saving_draft_info'));
    }
    logger.info(`任务 ${taskId} 进度70%：正在保存草稿信息。`);
    
    // 保存草稿信息到JSON文件
    await fs.promises.writeFile(
      path.join(draftPath, `draft_info.json`),
      JSON.stringify(script, null, 2)
    );
    logger.info(`草稿信息已保存到 ${draftId}/draft_info.json。`);

    // 读取并修改 draft_meta_info.json 文件
    try {
      const metaInfoPath = path.join(draftPath, 'draft_meta_info.json');
      let metaInfo = {};
      
      // 检查文件是否存在
      if (fs.existsSync(metaInfoPath)) {
        // 读取现有文件
        const metaInfoData = await fs.promises.readFile(metaInfoPath, 'utf8');
        metaInfo = JSON.parse(metaInfoData);
      }
      
      // 更新时间戳
      const currentMillisTimestamp = Date.now(); // 毫秒级时间戳
      const currentMicrosTimestamp = currentMillisTimestamp * 1000 + Math.floor(Math.random() * 1000); // 微秒级时间戳
      metaInfo.tm_draft_create = currentMillisTimestamp;
      metaInfo.tm_draft_modified = currentMicrosTimestamp;
      
      // 保存更新后的文件
      await fs.promises.writeFile(
        metaInfoPath,
        JSON.stringify(metaInfo, null, 2)
      );
      
      logger.info(`已更新 draft_meta_info.json 中的时间戳字段。`);
      if (progressCallback) {
        progressCallback(90, i18next.t('finalizing'));
      }
    } catch (error) {
      logger.error(`更新 draft_meta_info.json 失败:`, error);
      if (progressCallback) {
        progressCallback(-1, i18next.t('update_meta_info_failed', { error: error.message }));
      }
    }

    // 更新任务状态 - 完成
    logger.info(`任务 ${taskId} 已完成`);
    if (progressCallback) {
      progressCallback(100, '下载完成！');
    }
    return { success: true, message: '下载完成！' };

  } catch (error) {
    // 更新任务状态 - 失败
    logger.error(`保存草稿 ${draftId} 任务 ${taskId} 失败:`, error);
    if (progressCallback) {
      progressCallback(-1, i18next.t('processing_failed', { error: error.message }));
    }
    return { success: false, error: error.message, message: i18next.t('processing_failed', { error: error.message }) };
  }
}

module.exports = {
  saveDraftBackground,
  buildAssetPath
};
