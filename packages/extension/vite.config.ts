import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';

// 预生成的 1x1 蓝色 PNG (Base64)
// 用户可以后续替换为实际图标
const ICON_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwF/B/O3gwAAAABJRU5ErkJggg==';

export default defineConfig({
  plugins: [
    vue(),
    // 自定义插件：复制 manifest.json 并生成图标
    {
      name: 'copy-manifest',
      closeBundle() {
        const distDir = resolve(__dirname, 'dist');
        if (!existsSync(distDir)) {
          mkdirSync(distDir, { recursive: true });
        }
        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(distDir, 'manifest.json')
        );
        // 生成占位图标（用户可后续替换）
        const iconsDir = resolve(distDir, 'icons');
        if (!existsSync(iconsDir)) {
          mkdirSync(iconsDir, { recursive: true });
        }
        const iconBuffer = Buffer.from(ICON_PNG_BASE64, 'base64');
        [16, 32, 48, 128].forEach(size => {
          const iconPath = resolve(iconsDir, `icon${size}.png`);
          writeFileSync(iconPath, iconBuffer);
        });
        console.log('✓ Placeholder icons generated (replace with actual icons later)');
      },
    },
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        popup: resolve(__dirname, 'src/ui/popup/index.html'),
        options: resolve(__dirname, 'src/ui/options/index.html'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // background 输出到根目录
          if (chunkInfo.name === 'background') {
            return '[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: 'inline',
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
