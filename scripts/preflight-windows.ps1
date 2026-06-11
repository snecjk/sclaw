# StoClaw Windows pre-install environment check (run before Setup.exe).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/preflight-windows.ps1 [-BuildEnv production]

param(
    [ValidateSet('production', 'test', 'staging', 'development')]
    [string]$BuildEnv = 'production'
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$reqPath = Join-Path $root 'shared/windows-install-requirements.json'
$req = Get-Content $reqPath -Raw | ConvertFrom-Json

$ssoHost = $req.ssoHostByBuildEnv.$BuildEnv
if (-not $ssoHost) { $ssoHost = $req.ssoHostByBuildEnv.production }

$hardFails = [System.Collections.Generic.List[string]]::new()
$softWarns = [System.Collections.Generic.List[string]]::new()

function Test-HostPort {
    param([string]$HostName, [int]$Port = 443, [int]$TimeoutSec = 8)
    try {
        return (Test-NetConnection -ComputerName $HostName -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded
    } catch {
        return $false
    }
}

# OS version
$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
$is64 = [Environment]::Is64BitOperatingSystem
Write-Host "OS: $($os.Caption) build $build ($(if ($is64) { '64-bit' } else { '32-bit' }))"
if ($build -lt $req.minWin10Build) {
    $hardFails.Add("需要 Windows 10 版本 1809+（build >= $($req.minWin10Build)），当前 build $build")
}
if (-not $is64) {
    $hardFails.Add('需要 64 位 Windows')
}

# RAM (physical, GB)
$ramGb = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
Write-Host "Physical RAM: ${ramGb} GB"
if ($ramGb -lt $req.minRamGb) {
    $hardFails.Add("需要至少 $($req.minRamGb) GB 物理内存，当前 ${ramGb} GB")
}

# CPU cores (physical)
$cpuCores = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum
Write-Host "CPU physical cores: $cpuCores"
if ($cpuCores -lt $req.minCpuCores) {
    $hardFails.Add("需要至少 $($req.minCpuCores) 个物理 CPU 核心，当前 $cpuCores")
}

# Disk (system drive)
$sysDrive = $env:SystemDrive
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$sysDrive'"
$totalGb = [math]::Floor($disk.Size / 1GB)
$freeGb = [math]::Floor($disk.FreeSpace / 1GB)
Write-Host "Disk ${sysDrive}: total ${totalGb} GB, free ${freeGb} GB"
if ($totalGb -lt $req.minDiskTotalGb) {
    $hardFails.Add("${sysDrive} 总容量需要至少 $($req.minDiskTotalGb) GB，当前 ${totalGb} GB")
}
if ($freeGb -lt $req.minDiskFreeGb) {
    $hardFails.Add("${sysDrive} 可用空间需要至少 $($req.minDiskFreeGb) GB，当前 ${freeGb} GB")
}

# SSO (hard) — matches sso-service.ts SSO_ENVIRONMENTS
Write-Host "SSO host ($BuildEnv): $ssoHost"
if (-not (Test-HostPort $ssoHost)) {
    $hardFails.Add("无法连接 SSO 服务（$ssoHost`:443），登录将不可用")
}

# Soft checks (DWS / GitHub etc.)
foreach ($item in $req.softCheckHosts) {
    Write-Host "Soft check: $($item.label) -> $($item.host)"
    if (-not (Test-HostPort $item.host)) {
        $softWarns.Add("无法连接 $($item.label)（$($item.host)），部分功能可能受限，但不影响安装")
    }
}

Write-Host ''
if ($hardFails.Count -eq 0) {
    Write-Host 'HARD CHECKS: PASS' -ForegroundColor Green
} else {
    Write-Host 'HARD CHECKS: FAIL' -ForegroundColor Red
    $hardFails | ForEach-Object { Write-Host "  [FAIL] $_" -ForegroundColor Red }
}

if ($softWarns.Count -gt 0) {
    Write-Host 'SOFT WARNINGS:' -ForegroundColor Yellow
    $softWarns | ForEach-Object { Write-Host "  [WARN] $_" -ForegroundColor Yellow }
}

if ($hardFails.Count -gt 0) {
    exit 1
}
exit 0
