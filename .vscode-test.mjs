import { defineConfig } from '@vscode/test-cli'

export const config = {
	files: 'out/test/**/*.test.js',
	workspaceFolder: 'test-workspace',
}

export default defineConfig(config)
