const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { promisify } = require('util');

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
    downloadFile
};