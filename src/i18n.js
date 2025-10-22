import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';
import { app } from 'electron';

// 在渲染进程中，我们需要通过remote获取app对象
// 注意：在Electron 12+中，remote模块已被移除，需要使用contextBridge或preload脚本
const electron = window.require('electron');
const isDev = process.env.NODE_ENV === 'development';

// 确定本地化文件的路径
let localesPath;
if (isDev) {
  // 开发环境下的路径
  localesPath = path.join(__dirname, '../locales');
} else {
  // 生产环境下的路径（打包后）
  localesPath = path.join(electron.remote ? electron.remote.app.getAppPath() : process.resourcesPath, 'locales');
}

i18n
  .use(Backend)
  .use(initReactI18next)
  .init({
    backend: {
      loadPath: path.join(localesPath, '{{lng}}/{{ns}}.json')
    },
    fallbackLng: 'zh',
    debug: isDev,
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });

export default i18n;