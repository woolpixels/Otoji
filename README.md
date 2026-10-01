# Otoji · 提取与拼接音频

一个本地运行的小工具：**从视频里取出声音，把几段声音接起来**。

所有处理都在你的设备上完成——解码、裁切、编码全在浏览器（或桌面应用）内进行，**不上传任何文件，无需账号，断网也能用**。它不是音频编辑器，只把这两件事做好。

## 功能

**提取音频**
- 导入 MP4 / MOV / M4V，直接得到 MP3
- 拖动波形手柄或输入时间码裁切，只试听选区
- 128 / 192 / 320 kbps 三档音质，保留源声道数与采样率
- 默认去掉结尾 3 秒，省去短视频常见的片尾

**拼接音频**
- 多文件导入，按文件名自然排序（2 在 10 之前），可拖动调整顺序
- 段间静音间隔可统一设置，也可逐个缝隙单独覆盖
- 不必先合并即可按当前顺序连续试听
- 整体重新编码，拼接处没有 MP3 补帧造成的空隙

支持的音频输入：MP3，以及 M4A / WAV / FLAC / OGG。

## 使用

### 在浏览器中运行

需要 Node.js 20 或更高版本。

```bash
npm install --prefix app
npm run dev        # 打开 http://localhost:5173
```

`npm run build` 会在 `app/dist/` 生成静态站点，可部署到任意静态托管。需要通过 HTTP 访问，直接双击 `index.html` 无法运行（编码使用 Web Worker）。

### Mac 桌面版

提供 Apple 芯片（arm64）版本，可自行打包：

```bash
npm run dist       # 产物在 app/release/
```

应用目前只做了本机 ad-hoc 签名，未经 Apple 公证。首次打开如被系统拦截，请在访达中右键 Otoji.app → 打开。

## 隐私

不联网、不统计、不上传。ffmpeg.wasm（用于解码浏览器无法直接读取的格式）与字体都随应用打包，无需任何外部请求。

## 参与开发

技术栈：TypeScript + React + Vite，桌面版基于 Electron。版本号规则、发布步骤与实现细节见 [开发文档](docs/DEVELOPMENT.md)，更新历史见 [CHANGELOG](CHANGELOG.md)。

```bash
npm run lint && npm test
```

## 许可

[MIT](LICENSE)。第三方依赖遵循各自许可。注意：随应用打包的 `@ffmpeg/core`（ffmpeg.wasm）许可为 GPL-2.0-or-later，分发包含它的构建产物（网页站点或安装包）时需遵守该许可。
