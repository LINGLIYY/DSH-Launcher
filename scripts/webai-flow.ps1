# webai-flow.ps1 — 网页 AI 自动化流程的等待与判定辅助
# 用法：powershell -ExecutionPolicy Bypass -File scripts/webai-flow.ps1 -DoneRegex "停止|思考中"
param(
    [int]$Port = 9222,
    [int]$PollIntervalSec = 30,
    [int]$GenerationTimeoutSec = 300,
    [string]$DoneRegex = "停止|思考中"
)

function Invoke-AB {
    param([string]$Args)
    & agent-browser --cdp $Port @Args
}

function Wait-GenerationDone {
    <#
    .SYNOPSIS
    轮询网页 AI 是否结束生成，带超时与重试。
    #>
    $deadline = (Get-Date).AddSeconds($GenerationTimeoutSec)
    $attempt = 0
    while ((Get-Date) -lt $deadline) {
        $attempt++
        Write-Host "[webai] 轮询第 $attempt 次（间隔 ${PollIntervalSec}s）..."
        try {
            $out = & agent-browser --cdp $Port eval "(() => { const t=document.body.innerText; return /$DoneRegex/.test(t) ? 'STILL' : 'DONE'; })()"
            if ($out -match "DONE") {
                Write-Host "[webai] 生成完成。"
                return $true
            }
        }
        catch {
            Write-Warning "[webai] 轮询异常：$_"
        }
        Start-Sleep -Seconds $PollIntervalSec
    }
    Write-Warning "[webai] 等待超时（${GenerationTimeoutSec}s），生成未完成。"
    return $false
}

function Test-AiSuitable {
    <#
    .SYNOPSIS
    判定当前 AI 是否适合前端设计任务（排除 DeepSeek）。
    #>
    param([string]$Url)
    if ($Url -match "chat\.deepseek\.com|deepseek") {
        Write-Warning "[webai] DeepSeek 不适合前端设计，建议改用 Kimi/GLM/豆包/Qwen。"
        return $false
    }
    return $true
}

Export-ModuleMember -Function Wait-GenerationDone, Test-AiSuitable, Invoke-AB
