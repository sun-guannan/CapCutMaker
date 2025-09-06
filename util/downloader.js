const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { promisify } = require('util');
const AdmZip = require('adm-zip');
const { log } = require('console');

async function getArtistEffectDownloadUrl(effectId, apiKey) {
    const apiUrl = `https://open.capcutapi.top/cut_jianying/artist/get_artist_item?id=${effectId}`;
    const headers = {
        "Authorization": `Bearer ${apiKey}`
    };

    try {
        const response = await axios.post(apiUrl, {}, { headers });
        const result = response.data;

        if (result && result.status_code === 200) {
            const data = result.data && result.data.data ? result.data.data : {};
            const effectItems = data.effect_item_list || [];

            if (effectItems.length > 0) {
                const itemUrls = effectItems[0].common_attr && effectItems[0].common_attr.item_urls ? effectItems[0].common_attr.item_urls : [];
                if (itemUrls.length > 0) {
                    return itemUrls[0];
                }
            }
        }

        console.log(`无法获取花字特效 ${effectId} 的下载链接`);
        return null;

    } catch (error) {
        if (error.response) {
            console.log(`请求花字特效API失败: ${error.message}`);
        } else {
            console.log(`处理花字特效API响应时出错: ${error.message}`);
        }
        return null;
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
async function downloadFile(url, localFilename, maxRetries = 3, timeout = 180000, fileType = null) {
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
    
    // 根据file_type判断文件类型
    const isArtistEffectZip = fileType === "text_artist";
    const isTextTemplate = fileType === "text_template";

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
            
            const downloadedSize = fs.statSync(localFilename).size;
            const isImage = /\.(png|jpg|jpeg|gif|bmp)$/i.test(url);

            if (isImage && downloadedSize < 2048) {
                console.log(`Downloaded image size is suspiciously small (${downloadedSize} bytes). Attempting fallback download.`);
                const fallbackHeaders = {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                };
                const fallbackResponse = await axios({
                    method: 'GET',
                    url: url,
                    responseType: 'stream',
                    timeout: timeout,
                    headers: fallbackHeaders
                });
                const fallbackWriter = fs.createWriteStream(localFilename);
                fallbackResponse.data.pipe(fallbackWriter);
                await new Promise((resolve, reject) => {
                    fallbackWriter.on('finish', resolve);
                    fallbackWriter.on('error', reject);
                });
            }

            const finalSize = fs.statSync(localFilename).size;
            if (isImage && finalSize < 2048) {
                throw new Error(`Fallback download also resulted in a small file (${finalSize} bytes).`);
            }
            
            console.log(`\nDownload completed in ${(Date.now() - startTime) / 1000} seconds`);
            console.log(`File saved as: ${path.resolve(localFilename)}`);

            if (isArtistEffectZip) {
                await unzipAndCleanup(localFilename);
            }
            if (isTextTemplate) {
                await unzipTextTemplate(localFilename);
            }

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

async function unzipAndCleanup(zipFilePath) {
    const extractPath = path.dirname(zipFilePath);
    try {
        const zip = new AdmZip(zipFilePath);
        zip.extractAllTo(extractPath, true);
        console.log(`Successfully unzipped text template: ${zipFilePath}`);
        
        // 递归删除__MACOSX文件夹
        const macosxDir = path.join(extractPath, '__MACOSX');
        if (fs.existsSync(macosxDir)) {
            fs.rmSync(macosxDir, { recursive: true, force: true });
            console.log(`Removed __MACOSX directory from ${extractPath}`);
        }

        // 删除原始zip文件
        fs.unlinkSync(zipFilePath);
        console.log(`Removed original zip file: ${zipFilePath}`);
    } catch (e) {
        console.error(`Failed to unzip text template ${zipFilePath}: ${e.message}`, e);
    }
}

async function unzipTextTemplate(zipFilePath) {
    const extractPath = path.dirname(zipFilePath);
    try {
        const zip = new AdmZip(zipFilePath);
        zip.extractAllTo(extractPath, true);
        console.log(`Successfully unzipped text template: ${zipFilePath}`);
        
        // 递归删除__MACOSX文件夹
        const macosxDir = path.join(extractPath, '__MACOSX');
        if (fs.existsSync(macosxDir)) {
            fs.rmSync(macosxDir, { recursive: true, force: true });
            console.log(`Removed __MACOSX directory from ${extractPath}`);
        }

        // 删除原始zip文件
        fs.unlinkSync(zipFilePath);
        console.log(`Removed original zip file: ${zipFilePath}`);
    } catch (e) {
        console.error(`Failed to unzip text template ${zipFilePath}: ${e.message}`, e);
    }
}

module.exports = {
    getArtistEffectDownloadUrl,
    downloadFile,
    unzipAndCleanup,
    unzipTextTemplate
};