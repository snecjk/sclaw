# SAI CLI 二进制文件 - 平台版本选择指南

## 版本列表

| 目录 | 操作系统 | CPU 架构 | 适用场景 |
| --- | --- | --- | --- |
| `win-amd64/sai.exe` | Windows | x86_64 (AMD64) | 大多数 Windows 台式机、笔记本、服务器 |
| `win-arm64/sai.exe` | Windows | ARM64 | 搭载高通骁龙处理器的 Windows 设备（如 Surface Pro X） |
| `linux-amd64/sai` | Linux | x86_64 (AMD64) | 大多数 Linux 服务器、虚拟机、容器、WSL |
| `linux-arm64/sai` | Linux | ARM64 | ARM 架构的 Linux 服务器（如华为鲲鹏、AWS Graviton） |
| `mac-amd64/sai` | macOS | x86_64 (AMD64) | 2020 年及之前的 Intel 芯片 Mac |
| `mac-arm64/sai` | macOS | ARM64 (Apple Silicon) | 搭载 M1/M2/M3/M4 芯片的 Mac |

## 如何确认自己的平台

### Windows

1. 按 `Win + R`，输入 `msinfo32`，回车
2. 查看 **系统类型**：
   - 显示 `x64` → 选择 `win-amd64`
   - 显示 `ARM64` → 选择 `win-arm64`

或在命令行中执行：

```powershell
echo %PROCESSOR_ARCHITECTURE%
```

- 输出 `AMD64` → 选择 `win-amd64`
- 输出 `ARM64` → 选择 `win-arm64`

### Linux

在终端中执行：

```bash
uname -m
```

- 输出 `x86_64` → 选择 `linux-amd64`
- 输出 `aarch64` → 选择 `linux-arm64`

### macOS

在终端中执行：

```bash
uname -m
```

- 输出 `x86_64` → 选择 `mac-amd64`
- 输出 `arm64` → 选择 `mac-arm64`

> 提示：如果你的 Mac 是 2020 年之后购买的，大概率是 Apple Silicon（M 系列芯片），应选择 `mac-arm64`。

## 快速安装

下载对应平台的二进制文件后：

**Windows**：将 `sai.exe` 放到系统 PATH 目录中（如 `C:\Windows\System32` 或自定义目录），即可在命令行中直接使用 `sai` 命令。

**Linux / macOS**：

```bash
# 添加执行权限
chmod +x sai

# 移动到 PATH 目录
sudo mv sai /usr/local/bin/

# 验证安装
sai version
```

## 常见问题

**Q: macOS 提示"无法打开，因为无法验证开发者"怎么办？**

执行以下命令移除隔离属性：

```bash
xattr -d com.apple.quarantine sai
```

**Q: Linux 下执行提示"Permission denied"怎么办？**

需要先添加执行权限：

```bash
chmod +x sai
```

**Q: 选错了平台版本会怎样？**

程序无法运行。Windows 上可能提示"不是有效的 Win32 应用程序"，Linux/macOS 上会提示"cannot execute binary file"。请按照上方指南重新确认并选择正确的版本。
