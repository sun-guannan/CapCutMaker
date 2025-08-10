const { app, BrowserWindow, protocol, ipcMain, dialog } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// 读取package.json获取版本号
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const appVersion = packageJson.version;

// 生成version_code (每段版本号占3位)
function generateVersionCode(version) {
  const parts = version.split('.');
  let versionCode = 0;
  
  for (let i = 0; i < parts.length; i++) {
    versionCode = versionCode * 1000 + parseInt(parts[i]);
  }
  
  return versionCode;
}

const versionCode = generateVersionCode(appVersion);
console.log(`App Version: ${appVersion}, Version Code: ${versionCode}`);

// 保持对window对象的全局引用，如果不这么做的话，当JavaScript对象被
// 垃圾回收的时候，window对象将会自动的关闭
let mainWindow;

// 配置自动更新
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

// 自动更新事件监听
autoUpdater.on('checking-for-update', () => {
  sendStatusToWindow('正在检查更新...');
});

autoUpdater.on('update-available', (info) => {
  sendStatusToWindow('发现新版本，正在下载...');
});

autoUpdater.on('update-not-available', (info) => {
  sendStatusToWindow('当前已是最新版本');
});

autoUpdater.on('error', (err) => {
  sendStatusToWindow('更新出错: ' + err.toString());
});

autoUpdater.on('download-progress', (progressObj) => {
  let logMessage = `下载速度: ${progressObj.bytesPerSecond} - 已下载 ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
  sendStatusToWindow(logMessage);
});

autoUpdater.on('update-downloaded', (info) => {
  sendStatusToWindow('更新已下载，将在退出时安装');
  // 询问用户是否立即重启应用
  dialog.showMessageBox({
    type: 'info',
    title: '应用更新',
    message: '发现新版本，已下载完成',
    detail: '是否现在重启应用并安装更新？',
    buttons: ['是', '否']
  }).then((returnValue) => {
    if (returnValue.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

// 发送更新消息到渲染进程
function sendStatusToWindow(text) {
  console.log(text);
  if (mainWindow) {
    mainWindow.webContents.send('update-message', text);
  }
}

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      additionalArguments: [`--app-version=${appVersion}`, `--version-code=${versionCode}`]
    }
  });

  // 加载index.html文件
  mainWindow.loadFile('index.html');

  // 打开开发者工具
  // mainWindow.webContents.openDevTools();

  // 当window被关闭，这个事件会被触发
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
  
  // 检查更新
  autoUpdater.checkForUpdatesAndNotify();
}

// 注册自定义协议
app.whenReady().then(() => {
  protocol.registerFileProtocol('capcuthelper', (request, callback) => {
    const url = request.url.substr('capcuthelper://'.length);
    try {
      return callback(decodeURIComponent(url));
    } catch (error) {
      console.error('Failed to register protocol', error);
    }
  });
});

// 处理协议启动
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 当运行第二个实例时，将会聚焦到mainWindow这个窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      
      // 处理协议URL
      const url = commandLine.pop();
      if (url.startsWith('capcuthelper://')) {
        // 在这里处理URL参数
        console.log('Protocol URL:', url);
        // 可以将URL参数发送到渲染进程
        if (mainWindow.webContents) {
          mainWindow.webContents.send('protocol-url', url);
        }
      }
    }
  });

  // Electron 完成初始化并准备创建浏览器窗口时调用此方法
  app.whenReady().then(createWindow);

  // 协议处理 - macOS
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url.startsWith('capcuthelper://')) {
      console.log('Protocol URL (macOS):', url);
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('protocol-url', url);
      }
    }
  });

  // 当全部窗口关闭时退出
  app.on('window-all-closed', function () {
    // 在 macOS 上，除非用户用 Cmd + Q 确定地退出，
    // 否则绝大部分应用及其菜单栏会保持激活
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', function () {
    // 在macOS上，当单击dock图标并且没有其他窗口打开时，
    // 通常在应用程序中重新创建一个窗口
    if (mainWindow === null) createWindow();
  });
}

// 在macOS上，需要在app.setAsDefaultProtocolClient之前调用这个
app.setAsDefaultProtocolClient('capcuthelper');