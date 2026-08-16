# AIchess 多模型竞技场 —— 一键开发启动
# 用法: 在项目根目录执行  .\dev.ps1
# 说明: 使用项目内便携 Node(位于 .tools)，无需配置系统 PATH / 无需全局 npm。
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$nodeDir = Join-Path $root '.tools\node-v24.19.0-win-x64'
if (-not (Test-Path "$nodeDir\node.exe")) {
    Write-Error "未找到便携 Node: $nodeDir`n请先运行安装或下载 Node 便携版到该目录。"; exit 1
}
$env:PATH = "$nodeDir;$env:PATH"
$env:NODE_OPTIONS = '--experimental-sqlite'        # node:sqlite 需要实验标志(Node 24)
$env:npm_config_registry = 'https://registry.npmmirror.com'  # 国内镜像源
$env:PORT = '4000'
$env:WEB_ORIGIN = 'http://localhost:5173'
Set-Location $root
Write-Host "启动后端(http://localhost:4000) + 前端(http://localhost:5173) ..." -ForegroundColor Cyan
& "$nodeDir\npm.cmd" run dev
