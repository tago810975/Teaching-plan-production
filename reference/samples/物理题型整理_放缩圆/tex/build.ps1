<#
    build.ps1 —— 本目录的快捷编译（转调工程根的 tex\build.ps1）
    用法：
        .\build.ps1                    # 目录下唯一 .tex
        .\build.ps1 cap-dyn-01         # 指定作业名
        .\build.ps1 cap-dyn-01 -Clean  # 先清理中间文件
    产物：.\build\cap-dyn-01.pdf（学生版）、cap-dyn-01-teacher.pdf（教师版）
#>
param(
    [Parameter(Position = 0)][string]$Job,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\..\tex\build.ps1')

$args2 = @{ SrcDir = $PSScriptRoot }
if ($Job) { $args2['Job'] = $Job }
if ($Clean) { $args2['Clean'] = $true }

& $root @args2
