const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const { promisify } = require('util');

/**
 * 下载视频到指定目录
 * @param {string} videoUrl - 视频URL
 * @param {string} draftName - 草稿名称
 * @param {string} materialName - 素材名称
 * @returns {Promise<string>} - 本地视频路径
 */
async function downloadVideo(videoUrl, draftName, materialName) {
    // 确保目录存在 
    const videoDir = `${draftName}/assets/video`;
    await fs.promises.mkdir(videoDir, { recursive: true });
    
    // 生成本地文件名
    const localPath = `${videoDir}/${materialName}`;
    
    // 检查文件是否已存在
    if (fs.existsSync(localPath)) {
        console.log(`视频文件已存在: ${localPath}`);
        return localPath;
    }
    
    try {
        // 使用ffmpeg下载视频
        await new Promise((resolve, reject) => {
            const command = spawn('ffmpeg', [
                '-i', videoUrl,
                '-c', 'copy',  // 直接复制，不重新编码
                localPath
            ]);
            
            let errorOutput = '';
            command.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            command.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`下载视频失败: ${errorOutput}`));
                }
            });
        });
        
        return localPath;
    } catch (error) {
        throw new Error(`下载视频失败: ${error.message}`);
    }
}

/**
 * 下载图片到指定目录，并统一转换为PNG格式
 * @param {string} imageUrl - 图片URL
 * @param {string} draftName - 草稿名称
 * @param {string} materialName - 素材名称
 * @returns {Promise<string>} - 本地图片路径
 */
async function downloadImage(imageUrl, draftName, materialName) {
    // 确保目录存在
    const imageDir = `${draftName}/assets/image`;
    await fs.promises.mkdir(imageDir, { recursive: true });
    
    // 统一使用png格式
    const localPath = `${imageDir}/${materialName}`;
    
    // 检查文件是否已存在
    if (fs.existsSync(localPath)) {
        console.log(`图片文件已存在: ${localPath}`);
        return localPath;
    }
    
    try {
        // 使用ffmpeg下载并转换图片为PNG格式
        await new Promise((resolve, reject) => {
            const command = spawn('ffmpeg', [
                '-headers', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36\r\nReferer: https://www.163.com/\r\n',
                '-i', imageUrl,
                '-vf', 'format=rgba',  // 转换为RGBA格式以支持透明度
                '-frames:v', '1',      // 确保只处理一帧
                '-y',                  // 覆盖已存在的文件
                localPath
            ]);
            
            let errorOutput = '';
            command.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            command.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`下载图片失败: ${errorOutput}`));
                }
            });
        });
        
        return localPath;
    } catch (error) {
        throw new Error(`下载图片失败: ${error.message}`);
    }
}

/**
 * 下载音频并转码为MP3格式到指定目录
 * @param {string} audioUrl - 音频URL
 * @param {string} draftName - 草稿名称
 * @param {string} materialName - 素材名称
 * @returns {Promise<string>} - 本地音频路径
 */
async function downloadAudio(audioUrl, draftName, materialName) {
    // 确保目录存在
    const audioDir = `${draftName}/assets/audio`;
    await fs.promises.mkdir(audioDir, { recursive: true });
    
    // 生成本地文件名（保留.mp3后缀）
    const localPath = `${audioDir}/${materialName}`;
    
    // 检查文件是否已存在
    if (fs.existsSync(localPath)) {
        console.log(`音频文件已存在: ${localPath}`);
        return localPath;
    }
    
    try {
        // 使用ffmpeg下载并转码为MP3
        await new Promise((resolve, reject) => {
            const command = spawn('ffmpeg', [
                '-i', audioUrl,          // 输入URL
                '-c:a', 'libmp3lame',     // 强制将音频流编码为MP3
                '-q:a', '2',              // 设置音频质量（0-9，0为最佳，2为平衡质量与文件大小）
                '-y',                     // 覆盖已存在文件
                localPath                // 输出路径
            ]);
            
            let errorOutput = '';
            command.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            command.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`下载音频失败: ${errorOutput}`));
                }
            });
        });
        
        return localPath;
    } catch (error) {
        throw new Error(`下载音频失败: ${error.message}`);
    }
}

/**
 * 下载文件到指定路径
 * @param {string} url - 文件URL或本地路径
 * @param {string} localFilename - 本地保存路径
 * @param {number} maxRetries - 最大重试次数
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<boolean>} - 是否下载成功
 */
async function downloadFile(url, localFilename, maxRetries = 3, timeout = 180000) {
    // 检查是否是本地文件路径
    if (fs.existsSync(url) && fs.statSync(url).isFile()) {
        // 是本地文件，直接复制
        const directory = path.dirname(localFilename);
        
        // 创建目标目录（如果不存在）
        if (directory && !fs.existsSync(directory)) {
            await fs.promises.mkdir(directory, { recursive: true });
            console.log(`Created directory: ${directory}`);
        }
        
        console.log(`Copying local file: ${url} to ${localFilename}`);
        const startTime = Date.now();
        
        // 复制文件
        await fs.promises.copyFile(url, localFilename);
        
        console.log(`Copy completed in ${(Date.now() - startTime) / 1000} seconds`);
        console.log(`File saved as: ${path.resolve(localFilename)}`);
        return true;
    }
    
    // 原有的下载逻辑
    // Extract directory part
    const directory = path.dirname(localFilename);

    let retries = 0;
    while (retries < maxRetries) {
        try {
            if (retries > 0) {
                const waitTime = Math.pow(2, retries);  // 指数退避策略
                console.log(`Retrying in ${waitTime} seconds... (Attempt ${retries+1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
            }
            
            console.log(`Downloading file: ${localFilename}`);
            const startTime = Date.now();
            
            // 创建目录（如果不存在）
            if (directory && !fs.existsSync(directory)) {
                await fs.promises.mkdir(directory, { recursive: true });
                console.log(`Created directory: ${directory}`);
            }

            // 增强请求头
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://www.google.com/',  // 更通用的 Referer
                'Accept': '*/*',  // 接受任何类型的内容
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Cache-Control': 'max-age=0',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            };

            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                timeout: timeout,
                headers: headers
            });
            
            const totalSize = parseInt(response.headers['content-length'] || 0);
            const writer = fs.createWriteStream(localFilename);
            
            let bytesWritten = 0;
            
            response.data.on('data', (chunk) => {
                bytesWritten += chunk.length;
                
                if (totalSize > 0) {
                    const progress = bytesWritten / totalSize * 100;
                    process.stdout.write(`\r[PROGRESS] ${progress.toFixed(2)}% (${(bytesWritten/1024).toFixed(2)}KB/${(totalSize/1024).toFixed(2)}KB)`);
                }
            });
            
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
                response.data.pipe(writer);
            });
            
            console.log(`\nDownload completed in ${(Date.now() - startTime) / 1000} seconds`);
            console.log(`File saved as: ${path.resolve(localFilename)}`);
            return true;
                
        } catch (error) {
            if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
                console.log(`Download timed out after ${timeout/1000} seconds`);
            } else if (error.response) {
                console.log(`Request failed with status ${error.response.status}: ${error.message}`);
            } else {
                console.log(`Unexpected error during download: ${error.message}`);
            }
            
            retries++;
        }
    }
    
    console.log(`Download failed after ${maxRetries} attempts for URL: ${url}`);
    return false;
}

module.exports = {
    downloadVideo,
    downloadImage,
    downloadAudio,
    downloadFile
};