// Общий запуск Chromium для проверок, снимков и экспорта: программный WebGL (SwiftShader).
// Если браузер, ожидаемый установленной версией Playwright, не скачан, берётся Chromium из
// CHROMIUM_PATH или $PLAYWRIGHT_BROWSERS_PATH/chromium (так устроены облачные среды без загрузки браузеров).
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export function chromiumExecutable() {
  if (existsSync(chromium.executablePath())) return undefined;
  const candidates = [process.env.CHROMIUM_PATH, process.env.PLAYWRIGHT_BROWSERS_PATH && join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium')];
  return candidates.find((p) => p && existsSync(p));
}

export function launchChromium(options = {}) {
  const executablePath = options.executablePath ?? chromiumExecutable();
  return chromium.launch({ args: GL_ARGS, ...options, ...(executablePath ? { executablePath } : {}) });
}
